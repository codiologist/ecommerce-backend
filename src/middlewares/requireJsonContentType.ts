import { ApiError } from '../utils/ApiError.js';

import type { RequestHandler } from 'express';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
  if (!req.is('application/json')) {
    next(ApiError.unsupportedMediaType());
    return;
  }
  next();
};
