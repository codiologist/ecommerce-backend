import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';

import { redis } from '../lib/redis.js';
import { ApiError } from '../utils/ApiError.js';

import type { Request, RequestHandler } from 'express';

type LimiterOptions = {
  /** Unique name; becomes part of the Redis key prefix. */
  name: string;
  windowMs: number;
  limit: number;
  /** Defaults to the client IP (IPv6 grouped per /56). */
  key?: (req: Request) => string;
};

const clientIp = (req: Request): string => ipKeyGenerator(req.ip ?? 'unknown');

/**
 * Redis-backed rate limiter (works across instances, requirements §4.2).
 * Exceeding the limit returns 429 RATE_LIMITED with Retry-After.
 */
export function createRateLimiter({ name, windowMs, limit, key }: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: key ?? clientIp,
    store: new RedisStore({
      prefix: `rl:${name}:`,
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, ...args) as Promise<RedisReply>,
    }),
    handler: (req, res, next) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit
        ?.resetTime;
      const retryAfter = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.'));
    },
  });
}

const MINUTE = 60_000;

export const rateLimiters = {
  /** Every API request, per IP. */
  global: createRateLimiter({ name: 'global', windowMs: MINUTE, limit: 300 }),
  /** All /auth/* endpoints, per IP. */
  auth: createRateLimiter({ name: 'auth', windowMs: 15 * MINUTE, limit: 100 }),
  /** Login attempts per IP (per-account limits live in loginProtection). */
  login: createRateLimiter({ name: 'login', windowMs: 15 * MINUTE, limit: 30 }),
  /** Emails we send on demand (verification resend, password reset), per IP. */
  emailSend: createRateLimiter({ name: 'email', windowMs: 60 * MINUTE, limit: 10 }),
  register: createRateLimiter({ name: 'register', windowMs: 60 * MINUTE, limit: 10 }),
};
