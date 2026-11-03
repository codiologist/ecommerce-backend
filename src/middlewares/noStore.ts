import type { RequestHandler } from 'express';

/** API responses default to no-store; public cacheable endpoints can override per route later. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
