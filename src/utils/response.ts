import type { Response } from 'express';

export type PaginationMeta = {
  nextCursor?: string | null;
  page?: number;
  pageSize?: number;
  total?: number;
};

export type SuccessBody<T> = {
  success: true;
  data: T;
  meta?: { pagination?: PaginationMeta } & Record<string, unknown>;
};

export function sendSuccess<T>(
  res: Response,
  data: T,
  options: { status?: number; meta?: SuccessBody<T>['meta'] } = {},
): void {
  const body: SuccessBody<T> = { success: true, data };
  if (options.meta) body.meta = options.meta;
  res.status(options.status ?? 200).json(body);
}
