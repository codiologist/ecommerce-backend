import { type Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';

export const productDetailInclude = {
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
  variants: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      attributeValues: {
        include: {
          attributeValue: {
            include: { attribute: { select: { id: true, name: true, slug: true, type: true } } },
          },
        },
      },
    },
  },
  images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.ProductInclude;

export type ProductDetailRow = Prisma.ProductGetPayload<{ include: typeof productDetailInclude }>;

export const productListSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  isFeatured: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true, alt: true } },
  variants: {
    where: { deletedAt: null },
    select: { price: true, stock: true, lowStockThreshold: true, isActive: true },
  },
} satisfies Prisma.ProductSelect;

export type ProductListRow = Prisma.ProductGetPayload<{ select: typeof productListSelect }>;

/** Variants at or below their own low-stock threshold (column-to-column comparison). */
export const lowStockVariantWhere: Prisma.ProductVariantWhereInput = {
  deletedAt: null,
  stock: { lte: prisma.productVariant.fields.lowStockThreshold },
};

const notDeleted = { deletedAt: null } as const;

export const productsRepository = {
  list: (
    where: Prisma.ProductWhereInput,
    orderBy: Prisma.ProductOrderByWithRelationInput[],
    skip: number,
    take: number,
  ) =>
    prisma.$transaction([
      prisma.product.findMany({
        where: { ...where, ...notDeleted },
        orderBy,
        skip,
        take,
        select: productListSelect,
      }),
      prisma.product.count({ where: { ...where, ...notDeleted } }),
    ]),

  findDetail: (id: string) =>
    prisma.product.findFirst({ where: { id, ...notDeleted }, include: productDetailInclude }),

  findBasic: (id: string) => prisma.product.findFirst({ where: { id, ...notDeleted } }),

  slugExists: async (slug: string, exceptId?: string) =>
    (await prisma.product.count({
      where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
    })) > 0,

  categoryExists: async (id: string) =>
    (await prisma.category.count({ where: { id, ...notDeleted } })) > 0,
  brandExists: async (id: string) =>
    (await prisma.brand.count({ where: { id, ...notDeleted } })) > 0,

  existingSkus: async (skus: string[], exceptVariantId?: string) =>
    (
      await prisma.productVariant.findMany({
        where: { sku: { in: skus }, ...(exceptVariantId ? { id: { not: exceptVariantId } } : {}) },
        select: { sku: true },
      })
    ).map((v) => v.sku),

  attributeValuesByIds: (ids: string[]) =>
    prisma.attributeValue.findMany({
      where: { id: { in: ids } },
      select: { id: true, attributeId: true },
    }),

  activeVariantCount: (productId: string, exceptVariantId?: string) =>
    prisma.productVariant.count({
      where: {
        productId,
        ...notDeleted,
        isActive: true,
        ...(exceptVariantId ? { id: { not: exceptVariantId } } : {}),
      },
    }),

  update: (id: string, data: Prisma.ProductUncheckedUpdateInput) =>
    prisma.product.update({ where: { id }, data }),
};
