import { z } from 'zod';

import { optionalText, slugField } from '../catalog/common.js';

const base = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  slug: slugField.optional(),
  parentId: z.uuid().nullable().optional(),
  description: optionalText(2000),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  isActive: z.boolean().optional(),
  seoTitle: optionalText(70),
  seoDescription: optionalText(160),
};

export const createCategorySchema = z.object(base);
export const updateCategorySchema = z
  .object({ ...base, name: base.name.optional() })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const reorderCategoriesSchema = z.object({
  items: z
    .array(z.object({ id: z.uuid(), sortOrder: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(500),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;
