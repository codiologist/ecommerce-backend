import { durationToSeconds } from '../utils/time.js';

import { API_PREFIX } from './constants.js';
import { env, isProduction } from './env.js';

import type { CookieOptions, Request, Response } from 'express';

/** `__Secure-` names require the Secure attribute, so they are only used over HTTPS (production). */
const securePrefix = isProduction ? '__Secure-' : '';

export const COOKIE_NAMES = {
  accessToken: `${securePrefix}access_token`,
  refreshToken: `${securePrefix}refresh_token`,
  /** Non-HttpOnly so the frontend can read it and echo it in X-CSRF-Token (double-submit). */
  csrfToken: 'csrf_token',
} as const;

export const ACCESS_TOKEN_TTL_SECONDS = durationToSeconds(env.JWT_ACCESS_EXPIRES_IN);
export const REFRESH_COOKIE_PATH = `${API_PREFIX}/auth`;
const CSRF_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const domain = env.COOKIE_DOMAIN === 'localhost' ? {} : { domain: env.COOKIE_DOMAIN };

const base: CookieOptions = { secure: isProduction, ...domain };

export const cookieOptions = {
  accessToken: (): CookieOptions => ({
    ...base,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  }),
  refreshToken: (expiresAt: Date): CookieOptions => ({
    ...base,
    httpOnly: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  }),
  csrfToken: (): CookieOptions => ({
    ...base,
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: CSRF_COOKIE_MAX_AGE_MS,
  }),
};

export function readCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
): void {
  res.cookie(COOKIE_NAMES.accessToken, tokens.accessToken, cookieOptions.accessToken());
  res.cookie(
    COOKIE_NAMES.refreshToken,
    tokens.refreshToken,
    cookieOptions.refreshToken(tokens.refreshExpiresAt),
  );
}

export function setAccessCookie(res: Response, accessToken: string): void {
  res.cookie(COOKIE_NAMES.accessToken, accessToken, cookieOptions.accessToken());
}

export function clearAuthCookies(res: Response): void {
  const { maxAge: _a, ...access } = cookieOptions.accessToken();
  const { expires: _e, ...refresh } = cookieOptions.refreshToken(new Date());
  res.clearCookie(COOKIE_NAMES.accessToken, access);
  res.clearCookie(COOKIE_NAMES.refreshToken, refresh);
}
