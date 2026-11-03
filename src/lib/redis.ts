import { Redis } from 'ioredis';

import { env } from '../config/env.js';

import { logger } from './logger.js';

/** Single Redis connection (rate limits, login protection, 2FA challenges). */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
  lazyConnect: false,
});

redis.on('error', (err: Error) => {
  logger.error({ err: { message: err.message } }, 'Redis error');
});
