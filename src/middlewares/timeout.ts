import { ApiError } from '../utils/ApiError.js';

import type { RequestHandler } from 'express';

export const requestTimeout =
  (ms: number): RequestHandler =>
  (_req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) next(new ApiError(503, 'REQUEST_TIMEOUT', 'Request timed out'));
    }, ms);
    timer.unref();
    const clear = () => {
      clearTimeout(timer);
    };
    res.on('finish', clear);
    res.on('close', clear);
    next();
  };
