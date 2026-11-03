import { ApiError } from '../utils/ApiError.js';

import type { RequestHandler } from 'express';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** The only routes that accept multipart/form-data (admin image uploads). */
const MULTIPART_ROUTES = [
  new RegExp(`^/api/v1/admin/categories/${UUID}/image$`),
  new RegExp(`^/api/v1/admin/brands/${UUID}/logo$`),
  new RegExp(`^/api/v1/admin/products/${UUID}/images$`),
];
export const isMultipartRoute = (path: string): boolean =>
  MULTIPART_ROUTES.some((pattern) => pattern.test(path));

/**
 * Rejects requests that carry a body with an unexpected Content-Type (requirements §4.2).
 * Routes that legitimately accept multipart (admin uploads, Phase 2) will opt in explicitly.
 */
export const requireJsonContentType: RequestHandler = (req, _res, next) => {
  if (!BODY_METHODS.has(req.method)) {
    next();
    return;
  }
  const hasBody =
    req.headers['transfer-encoding'] !== undefined ||
    (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0');
  if (!hasBody) {
    next();
    return;
  }
  if (req.is('application/json')) {
    next();
    return;
  }
  // Explicit opt-in: multipart is accepted only on the image upload routes (Phase 2).
  if (req.method === 'POST' && req.is('multipart/form-data') && isMultipartRoute(req.path)) {
    next();
    return;
  }
  next(ApiError.unsupportedMediaType());
};
