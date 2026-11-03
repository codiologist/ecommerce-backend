import { isAdminRole } from '../modules/auth/session.service.js';
import { ApiError } from '../utils/ApiError.js';

import type { Role } from '@prisma/client';
import type { RequestHandler } from 'express';

export const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

/** Allows only the given roles. Must run after `authenticate` (requirements §3: backend checks every route). */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) {
      next(ApiError.unauthorized());
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(ApiError.forbidden('You do not have permission to perform this action'));
      return;
    }
    next();
  };

/** Staff/admin accounts must have 2FA enabled and this session must have passed it. */
export const requireAdminTwoFactor: RequestHandler = (req, _res, next) => {
  const auth = req.auth;
  if (!auth) {
    next(ApiError.unauthorized());
    return;
  }
  if (isAdminRole(auth.role)) {
    if (!auth.twoFactorEnabled) {
      next(
        ApiError.forbidden(
          'Set up two-factor authentication to continue',
          'TWO_FACTOR_SETUP_REQUIRED',
        ),
      );
      return;
    }
    if (!auth.twoFactorVerified) {
      next(ApiError.forbidden('Two-factor verification required', 'TWO_FACTOR_REQUIRED'));
      return;
    }
  }
  next();
};

/** Sensitive actions (delete product, change role, refund...) need a recent POST /auth/reauth. */
export const requireReauth: RequestHandler = (req, _res, next) => {
  const reauthAt = req.auth?.reauthAt;
  if (!reauthAt || Date.now() - reauthAt.getTime() > REAUTH_MAX_AGE_MS) {
    next(ApiError.forbidden('Please confirm your password to continue', 'REAUTH_REQUIRED'));
    return;
  }
  next();
};

/** Used from Phase 5: checkout requires a verified email (requirements §3). */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.auth?.emailVerified) {
    next(ApiError.forbidden('Please verify your email address first', 'EMAIL_NOT_VERIFIED'));
    return;
  }
  next();
};
