import { COOKIE_NAMES, cookieOptions, readCookie } from '../config/cookies.js';
import { env } from '../config/env.js';
import { hmacSha256, randomToken, safeEqual } from '../lib/crypto.js';
import { ApiError } from '../utils/ApiError.js';

import type { RequestHandler, Response } from 'express';

export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const allowedOrigins = new Set(env.CORS_ORIGINS);

/** Signed double-submit token: <random>.<hmac(random)>. Forged/unsigned values are rejected. */
export function issueCsrfToken(res: Response): string {
  const nonce = randomToken(32);
  const token = `${nonce}.${hmacSha256(env.CSRF_SECRET, nonce)}`;
  res.cookie(COOKIE_NAMES.csrfToken, token, cookieOptions.csrfToken());
  return token;
}

function isSignedToken(token: string): boolean {
  const [nonce, signature, extra] = token.split('.');
  if (!nonce || !signature || extra !== undefined) return false;
  return safeEqual(signature, hmacSha256(env.CSRF_SECRET, nonce));
}

function originAllowed(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  try {
    return allowedOrigins.has(new URL(value).origin);
  } catch {
    return false;
  }
}

/**
 * CSRF protection for state-changing requests (requirements §3):
 * 1. Origin (or Referer) must be in the allowlist when present (browsers always send Origin on
 *    cross-site POSTs). Non-browser clients without either header still need a valid token.
 * 2. X-CSRF-Token header must equal the csrf_token cookie (timing-safe) and carry a valid signature.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = originAllowed(req.get('origin')) ?? originAllowed(req.get('referer'));
  if (origin === false) {
    next(ApiError.forbidden('Request origin not allowed', 'CSRF_ORIGIN_MISMATCH'));
    return;
  }

  const header = req.get(CSRF_HEADER);
  const cookie = readCookie(req, COOKIE_NAMES.csrfToken);
  if (!header || !cookie || !safeEqual(header, cookie) || !isSignedToken(cookie)) {
    next(ApiError.forbidden('Invalid or missing CSRF token', 'CSRF_TOKEN_INVALID'));
    return;
  }
  next();
};
