import { prisma } from '../../lib/prisma.js';

import type { Prisma } from '@prisma/client';

const activeFamilyWhere = (familyId: string, now: Date): Prisma.SessionWhereInput => ({
  familyId,
  revokedAt: null,
  expiresAt: { gt: now },
});

export const sessionRepository = {
  create: (data: Prisma.SessionUncheckedCreateInput) => prisma.session.create({ data }),

  findByTokenHash: (tokenHash: string) =>
    prisma.session.findUnique({ where: { tokenHash }, include: { user: true } }),

  /** Current (non-revoked, non-expired) row of a family, with what `authenticate` needs. */
  findActiveInFamily: (familyId: string, now = new Date()) =>
    prisma.session.findFirst({
      where: activeFamilyWhere(familyId, now),
      orderBy: { createdAt: 'desc' },
      include: { user: { include: { twoFactorSecret: { select: { enabledAt: true } } } } },
    }),

  /**
   * Atomically marks a row as rotated and creates its successor.
   * Returns null if the row was already rotated/revoked by a concurrent request.
   */
  rotate: (oldId: string, next: Prisma.SessionUncheckedCreateInput, now: Date) =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.session.updateMany({
        where: { id: oldId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'ROTATED' },
      });
      if (updated.count !== 1) return null;
      return tx.session.create({ data: next });
    }),

  revokeFamily: (familyId: string, reason: string, now = new Date()) =>
    prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    }),

  revokeAllForUser: (userId: string, reason: string, exceptFamilyId?: string, now = new Date()) =>
    prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptFamilyId ? { familyId: { not: exceptFamilyId } } : {}),
      },
      data: { revokedAt: now, revokedReason: reason },
    }),

  /** Active sessions of a user, one row per family (the current refresh-token row). */
  listActiveForUser: (userId: string, now = new Date()) =>
    prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        familyId: true,
        userAgent: true,
        ip: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    }),

  /** IDOR-safe: only revokes if the family belongs to userId. */
  revokeFamilyOfUser: (userId: string, familyId: string, reason: string, now = new Date()) =>
    prisma.session.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    }),

  update: (id: string, data: Prisma.SessionUpdateInput) =>
    prisma.session.update({ where: { id }, data }),

  updateFamily: (familyId: string, data: Prisma.SessionUpdateManyMutationInput) =>
    prisma.session.updateMany({ where: { familyId, revokedAt: null }, data }),
};
