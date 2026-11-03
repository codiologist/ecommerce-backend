import { ApiError } from '../utils/ApiError.js';

import { env } from './env.js';

import type { CorsOptions } from 'cors';

const allowlist = new Set(env.CORS_ORIGINS);

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Requests without an Origin header (server-to-server, curl, same-origin GET) are not CORS requests.
    if (!origin || allowlist.has(origin)) {
      callback(null, true);
      return;
    }
    callback(ApiError.forbidden('Origin not allowed', 'CORS_ORIGIN_DENIED'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'Idempotency-Key'],
  exposedHeaders: ['X-Request-Id', 'Retry-After'],
  maxAge: 600,
};
