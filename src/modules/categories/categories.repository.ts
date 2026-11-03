import { prisma } from '../../lib/prisma.js';

import type { Prisma } from '@prisma/client';

const active = { deletedAt: null } as const;

export const categoriesRepository = {
  listAll: () =>
    prisma.category.findMany({
      where: active,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: { where: { deletedAt: null } } } } },
    }),

  findById: (id: string) => prisma.category.findFirst({ where: { id, ...active } }),

  slugExists: async (slug: string, exceptId?: string) =>
    (await prisma.category.count({
      where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
    })) > 0,

  parentIdOf: async (id: string) =>
    (await prisma.category.findUnique({ where: { id }, select: { parentId: true } }))?.parentId ??
    null,

  create: (data: Prisma.CategoryUncheckedCreateInput) => prisma.category.create({ data }),

  update: (id: string, data: Prisma.CategoryUncheckedUpdateInput) =>
    prisma.category.update({ where: { id }, data }),

  countActiveChildren: (id: string) =>
    prisma.category.count({ where: { parentId: id, ...active } }),

  countActiveProducts: (id: string) =>
    prisma.product.count({ where: { categoryId: id, deletedAt: null } }),

  reorder: (items: { id: string; sortOrder: number }[]) =>
    prisma.$transaction(
      items.map((item) =>
        prisma.category.updateMany({
          where: { id: item.id, ...active },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    ),
};
