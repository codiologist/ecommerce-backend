import { env, isProduction } from './env.js';

import type { CookieOptions } from 'express';

/**
 * Base cookie options shared by all auth-related cookies (see requirements §3).
 * The specific cookies (access, refresh, csrf, cart) are defined in Phase 1+.
 */
export const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
  ...(env.COOKIE_DOMAIN === 'localhost' ? {} : { domain: env.COOKIE_DOMAIN }),
};

/** `__Secure-` prefixed names require the Secure attribute, so only use them over HTTPS. */
export const cookieName = (name: string): string => (isProduction ? `__Secure-${name}` : name);
