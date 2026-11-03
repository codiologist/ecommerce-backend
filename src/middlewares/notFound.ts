import { ApiError } from '../utils/ApiError.js';

import type { RequestHandler } from 'express';

export const notFound: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.path} not found`, 'ROUTE_NOT_FOUND'));
};
