import { pino } from 'pino';

import { env, isProduction } from '../config/env.js';

/** Paths that must never reach logs (requirements §4.2: passwords, tokens, cookies, card data). */
export const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.totp',
  '*.code',
  '*.cardNumber',
  '*.cvv',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'ecommerce-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  ...(isProduction || env.NODE_ENV === 'test'
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      }),
});
