import { randomUUID } from 'node:crypto';

import { Role, UserStatus, type User } from '@prisma/client';

import { env } from '../../config/env.js';
import { randomToken, sha256 } from '../../lib/crypto.js';

import { signAccessToken } from './jwt.js';
import { sessionRepository } from './session.repository.js';

export type ClientContext = { ip: string | undefined; userAgent: string | undefined };

export type IssuedTokens = { accessToken: string; refreshToken: string; refreshExpiresAt: Date };

export type RefreshOutcome =
  | { kind: 'rotated'; tokens: IssuedTokens; userId: string }
  /** A just-rotated token was replayed within the grace window (e.g. two tabs refreshing at once). */
  | { kind: 'grace'; accessToken: string; userId: string }
  | { kind: 'reused'; userId: string; familyId: string }
  | { kind: 'invalid' };

export const ADMIN_ROLES: readonly Role[] = [Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN];
export const isAdminRole = (role: Role): boolean => ADMIN_ROLES.includes(role);

/** Window in which replaying the token that was just rotated is treated as a benign race. */
const ROTATION_GRACE_MS = 10_000;

function sessionLifetimeMs(role: Role): number {
  return isAdminRole(role)
    ? env.ADMIN_REFRESH_TOKEN_EXPIRES_HOURS * 60 * 60 * 1000 // shorter admin sessions (§3)
    : env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000;
}

const isUsable = (user: Pick<User, 'status' | 'deletedAt'>): boolean =>
  user.status === UserStatus.ACTIVE && user.deletedAt === null;

const clip = (value: string | undefined, max: number) => value?.slice(0, max) ?? null;

export const sessionService = {
  /** Starts a new login session (new refresh-token family). */
  async start(
    user: Pick<User, 'id' | 'role'>,
    ctx: ClientContext,
    options: { twoFactorVerified: boolean },
  ): Promise<IssuedTokens & { familyId: string }> {
    const refreshToken = randomToken(32);
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + sessionLifetimeMs(user.role));
    await sessionRepository.create({
      userId: user.id,
      familyId,
      tokenHash: sha256(refreshToken),
      ip: clip(ctx.ip, 64),
      userAgent: clip(ctx.userAgent, 512),
      expiresAt,
      twoFactorVerified: options.twoFactorVerified,
    });
    const accessToken = await signAccessToken({ sub: user.id, sid: familyId, role: user.role });
    return { accessToken, refreshToken, refreshExpiresAt: expiresAt, familyId };
  },

  /** Refresh-token rotation with reuse detection (requirements §3). */
  async refresh(refreshToken: string, ctx: ClientContext): Promise<RefreshOutcome> {
    const now = new Date();
    const row = await sessionRepository.findByTokenHash(sha256(refreshToken));
    if (!row) return { kind: 'invalid' };

    const graceIssue = async (): Promise<RefreshOutcome> => {
      const current = await sessionRepository.findActiveInFamily(row.familyId, now);
      if (!current || !isUsable(current.user)) return { kind: 'invalid' };
      const accessToken = await signAccessToken({
        sub: current.userId,
        sid: current.familyId,
        role: current.user.role,
      });
      return { kind: 'grace', accessToken, userId: current.userId };
    };

    if (row.revokedAt) {
      if (row.revokedReason !== 'ROTATED') return { kind: 'invalid' };
      if (now.getTime() - row.revokedAt.getTime() <= ROTATION_GRACE_MS) return graceIssue();
      // A rotated token came back after the grace window: assume theft, kill the whole family.
      await sessionRepository.revokeFamily(row.familyId, 'REUSE_DETECTED', now);
      return { kind: 'reused', userId: row.userId, familyId: row.familyId };
    }

    if (row.expiresAt <= now) return { kind: 'invalid' };
    if (!isUsable(row.user)) {
      await sessionRepository.revokeFamily(row.familyId, 'USER_INACTIVE', now);
      return { kind: 'invalid' };
    }

    const nextToken = randomToken(32);
    const next = await sessionRepository.rotate(
      row.id,
      {
        userId: row.userId,
        familyId: row.familyId,
        tokenHash: sha256(nextToken),
        ip: clip(ctx.ip, 64),
        userAgent: clip(ctx.userAgent, 512),
        expiresAt: row.expiresAt, // absolute lifetime from login; rotation never extends it
        twoFactorVerified: row.twoFactorVerified,
        reauthAt: row.reauthAt,
        lastUsedAt: now,
      },
      now,
    );
    if (!next) return graceIssue(); // lost a concurrent rotation race

    const accessToken = await signAccessToken({
      sub: row.userId,
      sid: row.familyId,
      role: row.user.role,
    });
    return {
      kind: 'rotated',
      userId: row.userId,
      tokens: { accessToken, refreshToken: nextToken, refreshExpiresAt: row.expiresAt },
    };
  },

  /** Revokes the family a refresh token belongs to (logout). Unknown tokens are ignored. */
  async revokeByRefreshToken(refreshToken: string, reason: string): Promise<string | null> {
    const row = await sessionRepository.findByTokenHash(sha256(refreshToken));
    if (!row) return null;
    await sessionRepository.revokeFamily(row.familyId, reason);
    return row.userId;
  },

  revokeFamily: (familyId: string, reason: string) =>
    sessionRepository.revokeFamily(familyId, reason),
  revokeAllForUser: (userId: string, reason: string, exceptFamilyId?: string) =>
    sessionRepository.revokeAllForUser(userId, reason, exceptFamilyId),
};
