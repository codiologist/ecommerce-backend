import { z } from 'zod';

import { offsetPaginationSchema } from '../../utils/pagination.js';

/** Manual adjustments. SALE/RETURN are written by order flows (Phase 5+), never by hand. */
export const stockAdjustmentSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((d) => d !== 0, 'Change must not be zero'),
  reason: z.enum(['RESTOCK', 'ADJUSTMENT', 'DAMAGE', 'CORRECTION']),
  note: z.string().trim().max(500).optional(),
});

export const movementsQuerySchema = offsetPaginationSchema;
export const lowStockQuerySchema = offsetPaginationSchema;

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
