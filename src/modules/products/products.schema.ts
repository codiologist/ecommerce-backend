import { z } from 'zod';

import { offsetPaginationSchema, queryBoolean } from '../../utils/pagination.js';
import { optionalText, slugField } from '../catalog/common.js';

/** Money in integer minor units (e.g. poisha). Upper bound keeps it inside Postgres INT. */
export const moneyField = z
  .number()
  .int('Use whole minor units (e.g. poisha)')
  .min(0)
  .max(2_000_000_000);

export const skuField = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'SKU is required')
  .max(64)
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letters, numbers, dot, dash or underscore');

const variantFields = {
  sku: skuField,
  price: moneyField,
  compareAtPrice: moneyField.nullable().optional(),
  lowStockThreshold: z.number().int().min(0).max(1_000_000).optional(),
  weightGrams: z.number().int().min(0).max(10_000_000).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  attributeValueIds: z.array(z.uuid()).max(10).optional(),
};

const compareAtAbovePrice = (d: {
  price?: number | undefined;
  compareAtPrice?: number | null | undefined;
}) =>
  d.compareAtPrice === null ||
  d.compareAtPrice === undefined ||
  d.price === undefined ||
  d.compareAtPrice > d.price;
const compareAtMessage = {
  message: 'Compare-at price must be higher than the price',
  path: ['compareAtPrice'],
};

export const createVariantSchema = z
  .object({ ...variantFields, initialStock: z.number().int().min(0).max(1_000_000).default(0) })
  .refine(compareAtAbovePrice, compareAtMessage);

export const updateVariantSchema = z
  .object({ ...variantFields, sku: skuField.optional(), price: moneyField.optional() })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' })
  .refine(compareAtAbovePrice, compareAtMessage);

const specification = z.object({
  name: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(500),
});

const productFields = {
  name: z.string().trim().min(1, 'Name is required').max(200),
  slug: slugField.optional(),
  /** Rich text; sanitized on the server before storage. */
  description: z.string().max(50_000).nullable().optional(),
  shortDescription: optionalText(500),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  categoryId: z.uuid().nullable().optional(),
  brandId: z.uuid().nullable().optional(),
  specifications: z.array(specification).max(50).optional(),
  seoTitle: optionalText(70),
  seoDescription: optionalText(160),
  isFeatured: z.boolean().optional(),
};

export const createProductSchema = z.object({
  ...productFields,
  variants: z.array(createVariantSchema).min(1, 'Add at least one variant').max(100),
});

export const updateProductSchema = z
  .object({ ...productFields, name: productFields.name.optional() })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const listProductsQuerySchema = offsetPaginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
  isFeatured: queryBoolean.optional(),
  lowStock: queryBoolean.optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'name']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const bulkProductsSchema = z.object({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate ids'),
  action: z.enum(['publish', 'draft', 'archive', 'delete']),
});

export const reorderImagesSchema = z.object({ imageIds: z.array(z.uuid()).min(1).max(20) });
export const updateImageSchema = z
  .object({ alt: optionalText(200), variantId: z.uuid().nullable().optional() })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const variantParamsSchema = z.object({ variantId: z.uuid() });
export const imageParamsSchema = z.object({ imageId: z.uuid() });

export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type BulkProductsInput = z.infer<typeof bulkProductsSchema>;
