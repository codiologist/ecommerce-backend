import { Prisma, UserStatus, type TwoFactorSecret, type User } from '@prisma/client';

import { audit } from '../../lib/audit.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { enqueue } from '../../lib/jobs.js';
import { mailer } from '../../lib/mailer.js';
import { redis } from '../../lib/redis.js';
import { turnstile } from '../../lib/turnstile.js';
import { ApiError } from '../../utils/ApiError.js';
import { sleep } from '../../utils/time.js';

import { authEmails, frontendLink } from './auth.emails.js';
import { authRepository } from './auth.repository.js';
import { loginProtection } from './login-protection.js';
import {
  checkPasswordPolicy,
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from './password.js';
import { sessionRepository } from './session.repository.js';
import {
  isAdminRole,
  sessionService,
  type ClientContext,
  type IssuedTokens,
} from './session.service.js';
import { backupCodes, totp } from './two-factor.js';

import type {
  LoginInput,
  LoginTwoFactorInput,
  ReauthInput,
  RegisterInput,
  ResetPasswordInput,
} from './auth.schema.js';
import type { AuthContext } from '../../types/express.js';
import type { Request } from 'express';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const TWO_FACTOR_CHALLENGE_TTL_SECONDS = 5 * 60;
const TWO_FACTOR_MAX_ATTEMPTS = 5;

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: User['role'];
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
};

export function toPublicUser(
  user: User & { twoFactorSecret?: Pick<TwoFactorSecret, 'enabledAt'> | null },
): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    twoFactorEnabled: Boolean(user.twoFactorSecret?.enabledAt),
    createdAt: user.createdAt.toISOString(),
  };
}

export const clientContext = (req: Request): ClientContext => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
});

export type LoginResult =
  | { kind: 'session'; tokens: IssuedTokens; user: PublicUser }
  | { kind: 'two_factor_required'; challengeId: string };

const challengeKey = (id: string) => `2fa:challenge:${sha256(id)}`;
const challengeAttemptsKey = (id: string) => `2fa:challenge:${sha256(id)}:attempts`;

async function sendVerificationEmail(user: Pick<User, 'id' | 'email' | 'name'>): Promise<void> {
  const token = randomToken(32);
  await authRepository.replaceEmailVerificationToken(
    user.id,
    sha256(token),
    new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
  );
  await mailer.send(
    authEmails.verifyEmail(user.email, user.name, frontendLink('/verify-email', token)),
  );
}

async function verifyTotpForUser(secret: TwoFactorSecret, code: string): Promise<boolean> {
  const result = await totp.verifyCode(secret.secretEncrypted, code, secret.lastUsedTimeStep);
  if (!result.valid) return false;
  const recorded = await authRepository.recordTotpUse(secret.userId, result.timeStep);
  return recorded.count === 1; // 0 => same code replayed concurrently
}

export const authService = {
  /**
   * Registration never reveals whether the email exists (requirements §3): the response is identical
   * and the password is always hashed so timing matches. Existing owners get a notice email instead.
   */
  async register(input: RegisterInput, req: Request): Promise<void> {
    if (!(await turnstile.verify(input.turnstileToken, req.ip))) {
      throw ApiError.badRequest('CAPTCHA verification failed', 'CAPTCHA_FAILED');
    }
    const passwordHash = await hashPassword(input.password);
    const existing = await authRepository.findUserByEmail(input.email);

    if (existing) {
      enqueue('mail.account-exists', () =>
        mailer.send(
          authEmails.accountExists(
            existing.email,
            frontendLink('/login'),
            frontendLink('/forgot-password'),
          ),
        ),
      );
      return;
    }

    let user: User;
    try {
      user = await authRepository.createUser({
        email: input.email,
        name: input.name,
        passwordHash,
      });
    } catch (err) {
      // Concurrent registration with the same email: behave as "already exists".
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      throw err;
    }
    await audit(
      { action: 'auth.register', actorId: user.id, targetType: 'User', targetId: user.id },
      req,
    );
    enqueue('mail.verify-email', () => sendVerificationEmail(user));
  },

  async verifyEmail(token: string, req: Request): Promise<void> {
    const userId = await authRepository.consumeEmailVerificationToken(sha256(token), new Date());
    if (!userId) {
      throw ApiError.badRequest('This link is invalid or has expired', 'TOKEN_INVALID');
    }
    await audit(
      { action: 'auth.email_verified', actorId: userId, targetType: 'User', targetId: userId },
      req,
    );
  },

  /** Same response whether or not the email exists / is already verified. */
  resendVerification(email: string): void {
    enqueue('mail.resend-verification', async () => {
      const user = await authRepository.findUserByEmail(email);
      if (!user || user.emailVerifiedAt || user.status !== UserStatus.ACTIVE) return;
      await sendVerificationEmail(user);
    });
  },

  async login(input: LoginInput, req: Request): Promise<LoginResult> {
    const gate = await loginProtection.check(input.email);
    if (gate.locked) {
      throw new ApiError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', {
        headers: { 'Retry-After': String(gate.retryAfterSeconds) },
      });
    }
    if (gate.captchaRequired) {
      if (!input.turnstileToken) {
        throw ApiError.forbidden('Please complete the CAPTCHA', 'CAPTCHA_REQUIRED');
      }
      if (!(await turnstile.verify(input.turnstileToken, req.ip))) {
        throw ApiError.badRequest('CAPTCHA verification failed', 'CAPTCHA_FAILED');
      }
    }

    const user = await authRepository.findUserByEmail(input.email);
    const passwordOk = user
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyAgainstDummy(input.password);

    if (!user || !passwordOk) {
      const failure = await loginProtection.recordFailure(input.email);
      await audit(
        {
          action: 'auth.login_failed',
          actorId: user?.id ?? null,
          metadata: { failures: failure.failures, knownUser: Boolean(user) },
        },
        req,
      );
      if (failure.lockedNow) {
        await audit({ action: 'auth.account_locked', actorId: user?.id ?? null }, req);
      }
      await sleep(failure.delayMs); // progressive delay, same for known and unknown emails
      throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // Only revealed after a correct password, so it doesn't enable enumeration.
    if (user.status !== UserStatus.ACTIVE) {
      await audit({ action: 'auth.login_blocked_user', actorId: user.id }, req);
      throw ApiError.forbidden(
        'This account has been blocked. Contact support.',
        'ACCOUNT_BLOCKED',
      );
    }

    await loginProtection.reset(input.email);

    if (user.twoFactorSecret?.enabledAt) {
      const challengeId = randomToken(32);
      await redis.set(
        challengeKey(challengeId),
        JSON.stringify({ userId: user.id }),
        'EX',
        TWO_FACTOR_CHALLENGE_TTL_SECONDS,
      );
      return { kind: 'two_factor_required', challengeId };
    }

    const tokens = await sessionService.start(user, clientContext(req), {
      twoFactorVerified: false,
    });
    await authRepository.updateUser(user.id, { lastLoginAt: new Date() });
    await audit(
      { action: 'auth.login_success', actorId: user.id, metadata: { twoFactor: false } },
      req,
    );
    return { kind: 'session', tokens, user: toPublicUser(user) };
  },

  async completeTwoFactorLogin(input: LoginTwoFactorInput, req: Request): Promise<LoginResult> {
    const invalidChallenge = () =>
      ApiError.unauthorized(
        'Your sign-in attempt expired. Please log in again.',
        'TWO_FACTOR_CHALLENGE_INVALID',
      );

    const raw = await redis.get(challengeKey(input.challengeId));
    if (!raw) throw invalidChallenge();

    const attempts = await redis.incr(challengeAttemptsKey(input.challengeId));
    await redis.expire(challengeAttemptsKey(input.challengeId), TWO_FACTOR_CHALLENGE_TTL_SECONDS);
    if (attempts > TWO_FACTOR_MAX_ATTEMPTS) {
      await redis.del(challengeKey(input.challengeId), challengeAttemptsKey(input.challengeId));
      throw invalidChallenge();
    }

    const { userId } = JSON.parse(raw) as { userId: string };
    const user = await authRepository.findUserById(userId);
    const secret = user?.twoFactorSecret;
    if (user?.status !== UserStatus.ACTIVE || !secret?.enabledAt) throw invalidChallenge();

    let ok = false;
    if (input.code) {
      ok = await verifyTotpForUser(secret, input.code);
    } else if (input.backupCode) {
      ok = await authRepository.consumeBackupCode(user.id, backupCodes.hash(input.backupCode));
      if (ok) await audit({ action: 'auth.backup_code_used', actorId: user.id }, req);
    }
    if (!ok) {
      await audit({ action: 'auth.2fa_failed', actorId: user.id, metadata: { attempts } }, req);
      throw ApiError.unauthorized('Invalid code', 'TWO_FACTOR_CODE_INVALID');
    }

    await redis.del(challengeKey(input.challengeId), challengeAttemptsKey(input.challengeId));
    const tokens = await sessionService.start(user, clientContext(req), {
      twoFactorVerified: true,
    });
    await authRepository.updateUser(user.id, { lastLoginAt: new Date() });
    await audit(
      { action: 'auth.login_success', actorId: user.id, metadata: { twoFactor: true } },
      req,
    );
    return { kind: 'session', tokens, user: toPublicUser(user) };
  },

  async refresh(refreshToken: string | undefined, req: Request) {
    if (!refreshToken) {
      throw ApiError.unauthorized('Session expired. Please log in again.', 'REFRESH_TOKEN_INVALID');
    }
    const outcome = await sessionService.refresh(refreshToken, clientContext(req));
    if (outcome.kind === 'reused') {
      await audit(
        {
          action: 'auth.refresh_token_reuse',
          actorId: outcome.userId,
          targetType: 'SessionFamily',
          targetId: outcome.familyId,
        },
        req,
      );
      req.log.warn(
        { userId: outcome.userId },
        'Refresh token reuse detected - session family revoked',
      );
      throw ApiError.unauthorized('Session expired. Please log in again.', 'REFRESH_TOKEN_REUSED');
    }
    if (outcome.kind === 'invalid') {
      throw ApiError.unauthorized('Session expired. Please log in again.', 'REFRESH_TOKEN_INVALID');
    }
    return outcome;
  },

  async logout(refreshToken: string | undefined, auth: AuthContext | undefined, req: Request) {
    let userId: string | null = null;
    if (refreshToken) userId = await sessionService.revokeByRefreshToken(refreshToken, 'LOGOUT');
    else if (auth) {
      await sessionService.revokeFamily(auth.sessionFamilyId, 'LOGOUT');
      userId = auth.userId;
    }
    if (userId) await audit({ action: 'auth.logout', actorId: userId }, req);
  },

  async logoutAll(auth: AuthContext, req: Request): Promise<void> {
    await sessionService.revokeAllForUser(auth.userId, 'LOGOUT_ALL');
    await audit({ action: 'auth.logout_all', actorId: auth.userId }, req);
  },

  /** Always the same response; the work happens in the background (no enumeration, no timing leak). */
  forgotPassword(email: string, req: Request): void {
    const meta = { ip: req.ip, userAgent: req.get('user-agent') };
    enqueue('mail.password-reset', async () => {
      const user = await authRepository.findUserByEmail(email);
      if (user?.status !== UserStatus.ACTIVE) return;
      const token = randomToken(32);
      await authRepository.replacePasswordResetToken(
        user.id,
        sha256(token),
        new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      );
      await mailer.send(
        authEmails.resetPassword(user.email, user.name, frontendLink('/reset-password', token)),
      );
      await audit({ action: 'auth.password_reset_requested', actorId: user.id, metadata: meta });
    });
  },

  async resetPassword(input: ResetPasswordInput, req: Request): Promise<void> {
    const now = new Date();
    const invalid = () =>
      ApiError.badRequest('This link is invalid or has expired', 'TOKEN_INVALID');
    const token = await authRepository.findValidPasswordResetToken(sha256(input.token), now);
    if (!token || token.user.deletedAt) throw invalid();

    const problem = checkPasswordPolicy(input.password, { email: token.user.email });
    if (problem) throw ApiError.validation([{ path: 'body.password', message: problem }]);

    const passwordHash = await hashPassword(input.password);
    const applied = await authRepository.applyPasswordReset(
      token.id,
      token.userId,
      passwordHash,
      now,
    );
    if (!applied) throw invalid();

    await loginProtection.reset(token.user.email);
    await audit({ action: 'auth.password_reset', actorId: token.userId }, req);
    const { email, name } = token.user;
    enqueue('mail.password-changed', () => mailer.send(authEmails.passwordChanged(email, name)));
  },

  /** Re-authentication for sensitive actions (requirements §3). */
  async reauth(auth: AuthContext, input: ReauthInput, req: Request): Promise<void> {
    const user = await authRepository.findUserById(auth.userId);
    if (!user) throw ApiError.unauthorized();
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await audit(
        { action: 'auth.login_failed', actorId: user.id, metadata: { reauth: true } },
        req,
      );
      throw ApiError.unauthorized('Incorrect password', 'INVALID_CREDENTIALS');
    }
    if (user.twoFactorSecret?.enabledAt) {
      if (!input.code) throw ApiError.badRequest('Enter your 2FA code', 'TWO_FACTOR_CODE_REQUIRED');
      if (!(await verifyTotpForUser(user.twoFactorSecret, input.code))) {
        await audit(
          { action: 'auth.2fa_failed', actorId: user.id, metadata: { reauth: true } },
          req,
        );
        throw ApiError.unauthorized('Invalid code', 'TWO_FACTOR_CODE_INVALID');
      }
    }
    await sessionRepository.update(auth.sessionId, { reauthAt: new Date() });
    await audit({ action: 'auth.reauth', actorId: user.id }, req);
  },

  // ---- two-factor management ----

  async setupTwoFactor(auth: AuthContext) {
    const user = await authRepository.findUserById(auth.userId);
    if (!user) throw ApiError.unauthorized();
    if (user.twoFactorSecret?.enabledAt) {
      throw ApiError.conflict(
        'Two-factor authentication is already enabled',
        'TWO_FACTOR_ALREADY_ENABLED',
      );
    }
    const { secret, encrypted } = totp.createSecret();
    await authRepository.upsertPendingTwoFactor(user.id, encrypted);
    return totp.setupPayload(secret, user.email);
  },

  async enableTwoFactor(auth: AuthContext, code: string, req: Request) {
    const user = await authRepository.findUserById(auth.userId);
    const secret = user?.twoFactorSecret;
    if (!user || !secret) {
      throw ApiError.badRequest('Start two-factor setup first', 'TWO_FACTOR_NOT_SET_UP');
    }
    if (secret.enabledAt) {
      throw ApiError.conflict(
        'Two-factor authentication is already enabled',
        'TWO_FACTOR_ALREADY_ENABLED',
      );
    }
    const result = await totp.verifyCode(secret.secretEncrypted, code, null);
    if (!result.valid) throw ApiError.badRequest('Invalid code', 'TWO_FACTOR_CODE_INVALID');

    const { codes, hashes } = backupCodes.generate();
    const enabled = await authRepository.enableTwoFactor(
      user.id,
      result.timeStep,
      hashes,
      new Date(),
    );
    if (enabled.count !== 1) {
      throw ApiError.conflict(
        'Two-factor authentication is already enabled',
        'TWO_FACTOR_ALREADY_ENABLED',
      );
    }
    // The user just proved possession of the authenticator in this session.
    await sessionRepository.updateFamily(auth.sessionFamilyId, { twoFactorVerified: true });
    await audit({ action: 'auth.2fa_enabled', actorId: user.id }, req);
    return { backupCodes: codes };
  },

  async disableTwoFactor(auth: AuthContext, req: Request): Promise<void> {
    if (isAdminRole(auth.role)) {
      throw ApiError.forbidden(
        'Two-factor authentication is mandatory for staff accounts',
        'TWO_FACTOR_REQUIRED_FOR_ROLE',
      );
    }
    await authRepository.deleteTwoFactor(auth.userId);
    await sessionRepository.updateFamily(auth.sessionFamilyId, { twoFactorVerified: false });
    await audit({ action: 'auth.2fa_disabled', actorId: auth.userId }, req);
  },
};
