import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

import { isProduction } from '../config/env.js';
import { ApiError, type ErrorDetail } from '../utils/ApiError.js';

import type { ErrorRequestHandler } from 'express';

type BodyParserError = Error & { type?: string; status?: number; statusCode?: number };

function isBodyParserError(err: unknown): err is BodyParserError {
  return err instanceof Error && typeof (err as BodyParserError).type === 'string';
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    const details: ErrorDetail[] = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return ApiError.validation(details);
  }

  if (isBodyParserError(err)) {
    switch (err.type) {
      case 'entity.too.large':
        return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
      case 'entity.parse.failed':
        return ApiError.badRequest('Malformed JSON body', 'INVALID_JSON');
      case 'encoding.unsupported':
      case 'charset.unsupported':
        return ApiError.unsupportedMediaType('Unsupported body encoding');
      default:
        return ApiError.badRequest('Invalid request body', 'INVALID_BODY');
    }
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    // Unique constraint. Field names are not exposed.
    return ApiError.conflict('Resource already exists', 'CONFLICT');
  }

  // Anything else (Prisma errors, programming errors...) is never exposed to the client.
  return ApiError.internal('Internal server error', err);
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const apiError = toApiError(err);

  if (apiError.statusCode >= 500) {
    req.log.error({ err, requestId: req.id }, 'Unhandled error');
  } else {
    req.log.warn({ code: apiError.code, status: apiError.statusCode }, apiError.message);
  }

  if (res.headersSent) {
    res.end();
    return;
  }

  if (apiError.headers) {
    for (const [name, value] of Object.entries(apiError.headers)) res.setHeader(name, value);
  }

  const expose = apiError.expose || !isProduction;
  res.status(apiError.statusCode).json({
    success: false,
    error: {
      code: apiError.code,
      message: expose ? apiError.message : 'Internal server error',
      ...(apiError.details && expose ? { details: apiError.details } : {}),
      requestId: req.id,
    },
  });
};
