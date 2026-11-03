import { z } from 'zod';

import { MAX_PAGE_SIZE } from '../config/constants.js';

/** Offset pagination for admin tables (requirements §6: offset allowed in admin, max page size enforced). */
export const offsetPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type OffsetPagination = z.infer<typeof offsetPaginationSchema>;

export const toSkipTake = ({ page, pageSize }: OffsetPagination) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

export const paginationMeta = ({ page, pageSize }: OffsetPagination, total: number) => ({
  pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
});

/** Query-string booleans: only "true"/"false" are accepted. */
export const queryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');
