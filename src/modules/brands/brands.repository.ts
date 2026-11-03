import { prisma } from '../../lib/prisma.js';

import type { Prisma } from '@prisma/client';

const active = { deletedAt: null } as const;

export const brandsRepository = {
  list: (
    where: Prisma.BrandWhereInput,
    orderBy: Prisma.BrandOrderByWithRelationInput[],
    skip: number,
    take: number,
  ) =>
    prisma.$transaction([
      prisma.brand.findMany({
        where: { ...where, ...active },
        orderBy,
        skip,
        take,
        include: { _count: { select: { products: { where: { deletedAt: null } } } } },
      }),
      prisma.brand.count({ where: { ...where, ...active } }),
    ]),

  findById: (id: string) => prisma.brand.findFirst({ where: { id, ...active } }),

  slugExists: async (slug: string, exceptId?: string) =>
    (await prisma.brand.count({
      where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
    })) > 0,

  create: (data: Prisma.BrandUncheckedCreateInput) => prisma.brand.create({ data }),
  update: (id: string, data: Prisma.BrandUncheckedUpdateInput) =>
    prisma.brand.update({ where: { id }, data }),

  countActiveProducts: (id: string) =>
    prisma.product.count({ where: { brandId: id, deletedAt: null } }),
};
