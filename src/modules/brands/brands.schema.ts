import { z } from 'zod';

import { offsetPaginationSchema, queryBoolean } from '../../utils/pagination.js';
import { optionalText, slugField } from '../catalog/common.js';

const base = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  slug: slugField.optional(),
  description: optionalText(2000),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  isActive: z.boolean().optional(),
};

export const createBrandSchema = z.object(base);
export const updateBrandSchema = z
  .object({ ...base, name: base.name.optional() })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const listBrandsQuerySchema = offsetPaginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  isActive: queryBoolean.optional(),
  sort: z.enum(['name', 'sortOrder', 'createdAt']).default('sortOrder'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
export type ListBrandsQuery = z.infer<typeof listBrandsQuerySchema>;
