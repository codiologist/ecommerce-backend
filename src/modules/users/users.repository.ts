import { prisma } from '../../lib/prisma.js';

import type { Prisma } from '@prisma/client';

export const usersRepository = {
  findById: (id: string) =>
    prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { twoFactorSecret: { select: { enabledAt: true } } },
    }),

  update: (id: string, data: Prisma.UserUpdateInput) =>
    prisma.user.update({
      where: { id },
      data,
      include: { twoFactorSecret: { select: { enabledAt: true } } },
    }),

  /** Updates the hash and revokes every other session in one transaction. */
  changePassword: (userId: string, passwordHash: string, keepFamilyId: string, now: Date) =>
    prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: now } }),
      prisma.session.updateMany({
        where: { userId, revokedAt: null, familyId: { not: keepFamilyId } },
        data: { revokedAt: now, revokedReason: 'PASSWORD_CHANGED' },
      }),
    ]),
};
