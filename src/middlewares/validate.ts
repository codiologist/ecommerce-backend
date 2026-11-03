import { ApiError, type ErrorDetail } from '../utils/ApiError.js';

import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType };

function toDetails(
  issues: { path: PropertyKey[]; message: string }[],
  prefix: string,
): ErrorDetail[] {
  return issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}

/**
 * Validates and REPLACES body/query/params with the parsed result (requirements §4.2).
 * Object schemas strip unknown keys by default, which prevents mass assignment.
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    const details: ErrorDetail[] = [];
    const parsed: { body?: unknown; query?: unknown; params?: unknown } = {};

    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(key === 'body' ? (req.body ?? {}) : req[key]);
      if (result.success) parsed[key] = result.data;
      else details.push(...toDetails(result.error.issues, key));
    }

    if (details.length > 0) {
      next(ApiError.validation(details));
      return;
    }
    if (schemas.body) req.body = parsed.body;
    // Express 5 exposes req.query via a getter; shadow it with the validated value.
    if (schemas.query)
      Object.defineProperty(req, 'query', { value: parsed.query, writable: false });
    if (schemas.params) req.params = parsed.params as typeof req.params;
    next();
  };
