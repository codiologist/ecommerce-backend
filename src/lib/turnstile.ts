import { env, isProduction } from '../config/env.js';

import { logger } from './logger.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

type SiteverifyResponse = { success: boolean; 'error-codes'?: string[] };

export const turnstile = {
  /** Server-side verification of a Cloudflare Turnstile token (requirements §3). */
  async verify(token: string | undefined, ip: string | undefined): Promise<boolean> {
    if (!env.TURNSTILE_SECRET_KEY) {
      // Production refuses to start without a key (env.ts); dev/test may run without one.
      if (isProduction) return false;
      logger.warn('TURNSTILE_SECRET_KEY not set - skipping CAPTCHA verification (non-production)');
      return true;
    }
    if (!token) return false;
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
    if (ip) body.set('remoteip', ip);
    try {
      const response = await fetch(VERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5_000),
      });
      const result = (await response.json()) as SiteverifyResponse;
      return result.success;
    } catch (err) {
      logger.error({ err }, 'Turnstile verification failed');
      return false; // fail closed
    }
  },
};
