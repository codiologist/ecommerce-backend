import { z } from 'zod';

import { slugField } from '../catalog/common.js';

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1A2B3C')
  .transform((v) => v.toUpperCase());

export const createAttributeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  slug: slugField.optional(),
  type: z.enum(['SELECT', 'COLOR']).default('SELECT'),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});

export const updateAttributeSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    slug: slugField.optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const createAttributeValueSchema = z.object({
  value: z.string().trim().min(1, 'Value is required').max(60),
  slug: slugField.optional(),
  colorHex: hexColor.nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});

export const updateAttributeValueSchema = z
  .object({
    value: z.string().trim().min(1).max(60).optional(),
    slug: slugField.optional(),
    colorHex: hexColor.nullable().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const valueParamsSchema = z.object({ valueId: z.uuid() });

export type CreateAttributeInput = z.infer<typeof createAttributeSchema>;
export type UpdateAttributeInput = z.infer<typeof updateAttributeSchema>;
export type CreateAttributeValueInput = z.infer<typeof createAttributeValueSchema>;
export type UpdateAttributeValueInput = z.infer<typeof updateAttributeValueSchema>;
