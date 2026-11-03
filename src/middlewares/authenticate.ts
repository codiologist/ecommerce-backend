import { UserStatus } from '@prisma/client';

import { COOKIE_NAMES, readCookie } from '../config/cookies.js';
import { verifyAccessToken } from '../modules/auth/jwt.js';
import { sessionRepository } from '../modules/auth/session.repository.js';
import { ApiError } from '../utils/ApiError.js';

import type { AuthContext } from '../types/express.js';
import type { RequestHandler } from 'express';

/**
 * Verifies the access-token cookie AND that its session family is still active, then loads the user.
 * Role/status always come from the database, so revocation, blocking and role changes apply
 * immediately rather than when the JWT expires.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = readCookie(req, COOKIE_NAMES.accessToken);
  if (!token) {
    next(ApiError.unauthorized('Authentication required', 'UNAUTHORIZED'));
    return;
  }

  const verified = await verifyAccessToken(token);
  if (!verified.ok) {
    next(
      verified.reason === 'expired'
        ? ApiError.unauthorized('Access token expired', 'ACCESS_TOKEN_EXPIRED')
        : ApiError.unauthorized('Authentication required', 'UNAUTHORIZED'),
    );
    return;
  }

  const session = await sessionRepository.findActiveInFamily(verified.claims.sid);
  const user = session?.user;
  if (
    !session ||
    !user ||
    session.userId !== verified.claims.sub ||
    user.status !== UserStatus.ACTIVE ||
    user.deletedAt !== null
  ) {
    next(ApiError.unauthorized('Session is no longer valid', 'SESSION_REVOKED'));
    return;
  }

  req.auth = {
    userId: user.id,
    role: user.role,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    sessionFamilyId: session.familyId,
    sessionId: session.id,
    twoFactorVerified: session.twoFactorVerified,
    twoFactorEnabled: Boolean(user.twoFactorSecret?.enabledAt),
    reauthAt: session.reauthAt,
  };
  next();
};

/** Narrows req.auth for handlers mounted after `authenticate`. */
export function requireAuthContext(auth: AuthContext | undefined): AuthContext {
  if (!auth) throw ApiError.unauthorized();
  return auth;
}
