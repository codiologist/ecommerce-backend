import { prisma } from '../../lib/prisma.js';

import type { Prisma } from '@prisma/client';

const withValues = {
  values: {
    orderBy: [{ sortOrder: 'asc' as const }, { value: 'asc' as const }],
    include: { _count: { select: { variants: true } } },
  },
};

export const attributesRepository = {
  list: () =>
    prisma.attribute.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: withValues,
    }),

  findById: (id: string) => prisma.attribute.findUnique({ where: { id }, include: withValues }),

  slugExists: async (slug: string, exceptId?: string) =>
    (await prisma.attribute.count({
      where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
    })) > 0,

  create: (data: Prisma.AttributeCreateInput) =>
    prisma.attribute.create({ data, include: withValues }),
  update: (id: string, data: Prisma.AttributeUpdateInput) =>
    prisma.attribute.update({ where: { id }, data, include: withValues }),
  delete: (id: string) => prisma.attribute.delete({ where: { id } }),

  usageCount: (attributeId: string) =>
    prisma.variantAttributeValue.count({ where: { attributeId } }),

  // ---- values ----
  findValue: (id: string) =>
    prisma.attributeValue.findUnique({ where: { id }, include: { attribute: true } }),

  valueSlugExists: async (attributeId: string, slug: string, exceptId?: string) =>
    (await prisma.attributeValue.count({
      where: { attributeId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
    })) > 0,

  createValue: (data: Prisma.AttributeValueUncheckedCreateInput) =>
    prisma.attributeValue.create({ data }),
  updateValue: (id: string, data: Prisma.AttributeValueUncheckedUpdateInput) =>
    prisma.attributeValue.update({ where: { id }, data }),
  deleteValue: (id: string) => prisma.attributeValue.delete({ where: { id } }),
  valueUsageCount: (attributeValueId: string) =>
    prisma.variantAttributeValue.count({ where: { attributeValueId } }),
};
