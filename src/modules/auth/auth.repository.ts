import { prisma } from '../../lib/prisma.js';

import type { Prisma } from '@prisma/client';

const notDeleted = { deletedAt: null } as const;

export const authRepository = {
  // ---- users ----
  findUserByEmail: (email: string) =>
    prisma.user.findFirst({
      where: { email, ...notDeleted },
      include: { twoFactorSecret: true },
    }),

  findUserById: (id: string) =>
    prisma.user.findFirst({ where: { id, ...notDeleted }, include: { twoFactorSecret: true } }),

  createUser: (data: Prisma.UserCreateInput) => prisma.user.create({ data }),

  updateUser: (id: string, data: Prisma.UserUpdateInput) =>
    prisma.user.update({ where: { id }, data }),

  // ---- email verification tokens ----
  replaceEmailVerificationToken: (userId: string, tokenHash: string, expiresAt: Date) =>
    prisma.$transaction([
      prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } }),
      prisma.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt } }),
    ]),

  /** Single-use: marks the token used and verifies the user atomically. Returns the userId or null. */
  consumeEmailVerificationToken: (tokenHash: string, now: Date) =>
    prisma.$transaction(async (tx) => {
      const token = await tx.emailVerificationToken.findUnique({ where: { tokenHash } });
      if (!token || token.usedAt || token.expiresAt <= now) return null;
      const marked = await tx.emailVerificationToken.updateMany({
        where: { id: token.id, usedAt: null },
        data: { usedAt: now },
      });
      if (marked.count !== 1) return null;
      await tx.user.updateMany({
        where: { id: token.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      return token.userId;
    }),

  // ---- password reset tokens ----
  replacePasswordResetToken: (userId: string, tokenHash: string, expiresAt: Date) =>
    prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
      prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } }),
    ]),

  findValidPasswordResetToken: (tokenHash: string, now: Date) =>
    prisma.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      include: { user: true },
    }),

  /**
   * Single-use reset: marks the token used, sets the new hash, verifies the email (ownership proven)
   * and revokes every session - all in one transaction. Returns false if the token was already used.
   */
  applyPasswordReset: (tokenId: string, userId: string, passwordHash: string, now: Date) =>
    prisma.$transaction(async (tx) => {
      const marked = await tx.passwordResetToken.updateMany({
        where: { id: tokenId, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (marked.count !== 1) return false;
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: now },
      });
      await tx.user.updateMany({
        where: { id: userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'PASSWORD_RESET' },
      });
      return true;
    }),

  // ---- two-factor ----
  upsertPendingTwoFactor: (userId: string, secretEncrypted: string) =>
    prisma.twoFactorSecret.upsert({
      where: { userId },
      create: { userId, secretEncrypted, backupCodeHashes: [] },
      update: { secretEncrypted, enabledAt: null, lastUsedTimeStep: null, backupCodeHashes: [] },
    }),

  enableTwoFactor: (userId: string, timeStep: number, backupCodeHashes: string[], now: Date) =>
    prisma.twoFactorSecret.updateMany({
      where: { userId, enabledAt: null },
      data: { enabledAt: now, lastUsedTimeStep: timeStep, backupCodeHashes },
    }),

  /** Replay-safe: only advances if no newer step was accepted concurrently. */
  recordTotpUse: (userId: string, timeStep: number) =>
    prisma.twoFactorSecret.updateMany({
      where: {
        userId,
        OR: [{ lastUsedTimeStep: null }, { lastUsedTimeStep: { lt: timeStep } }],
      },
      data: { lastUsedTimeStep: timeStep },
    }),

  /** Consumes one backup code atomically. Returns true if the code existed. */
  consumeBackupCode: (userId: string, codeHash: string) =>
    prisma.$transaction(async (tx) => {
      const record = await tx.twoFactorSecret.findUnique({ where: { userId } });
      if (!record?.enabledAt || !record.backupCodeHashes.includes(codeHash)) return false;
      const updated = await tx.twoFactorSecret.updateMany({
        where: { userId, backupCodeHashes: { has: codeHash } },
        data: { backupCodeHashes: record.backupCodeHashes.filter((h) => h !== codeHash) },
      });
      return updated.count === 1;
    }),

  deleteTwoFactor: (userId: string) => prisma.twoFactorSecret.deleteMany({ where: { userId } }),
};
