import { audit } from '../../lib/audit.js';
import { enqueue } from '../../lib/jobs.js';
import { mailer } from '../../lib/mailer.js';
import { ApiError } from '../../utils/ApiError.js';
import { authEmails } from '../auth/auth.emails.js';
import { toPublicUser, type PublicUser } from '../auth/auth.service.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../auth/password.js';
import { sessionRepository } from '../auth/session.repository.js';

import { usersRepository } from './users.repository.js';

import type { ChangePasswordInput, UpdateMeInput } from './users.schema.js';
import type { AuthContext } from '../../types/express.js';
import type { Request } from 'express';

export type SessionView = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};

export const usersService = {
  async getMe(auth: AuthContext): Promise<PublicUser> {
    const user = await usersRepository.findById(auth.userId);
    if (!user) throw ApiError.unauthorized();
    return toPublicUser(user);
  },

  async updateMe(auth: AuthContext, input: UpdateMeInput): Promise<PublicUser> {
    const user = await usersRepository.update(auth.userId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
    });
    return toPublicUser(user);
  },

  async changePassword(auth: AuthContext, input: ChangePasswordInput, req: Request): Promise<void> {
    const user = await usersRepository.findById(auth.userId);
    if (!user) throw ApiError.unauthorized();
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw ApiError.badRequest('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
    }
    const problem = checkPasswordPolicy(input.newPassword, { email: user.email });
    if (problem) throw ApiError.validation([{ path: 'body.newPassword', message: problem }]);

    await usersRepository.changePassword(
      user.id,
      await hashPassword(input.newPassword),
      auth.sessionFamilyId,
      new Date(),
    );
    await audit({ action: 'auth.password_changed', actorId: user.id }, req);
    enqueue('mail.password-changed', () =>
      mailer.send(authEmails.passwordChanged(user.email, user.name)),
    );
  },

  /** Active sessions ("devices"). The id exposed is the session family id. */
  async listSessions(auth: AuthContext): Promise<SessionView[]> {
    const rows = await sessionRepository.listActiveForUser(auth.userId);
    return rows.map((row) => ({
      id: row.familyId,
      userAgent: row.userAgent,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      current: row.familyId === auth.sessionFamilyId,
    }));
  },

  /** IDOR-safe: filters by the authenticated userId; another user's id behaves like "not found". */
  async revokeSession(auth: AuthContext, familyId: string, req: Request): Promise<void> {
    const result = await sessionRepository.revokeFamilyOfUser(
      auth.userId,
      familyId,
      'USER_REVOKED',
    );
    if (result.count === 0) throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    await audit(
      {
        action: 'auth.session_revoked',
        actorId: auth.userId,
        targetType: 'SessionFamily',
        targetId: familyId,
      },
      req,
    );
  },
};
