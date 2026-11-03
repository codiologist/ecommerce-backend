import { errors, jwtVerify, SignJWT } from 'jose';

import { ACCESS_TOKEN_TTL_SECONDS } from '../../config/cookies.js';
import { env } from '../../config/env.js';

import type { Role } from '@prisma/client';

const ALGORITHM = 'HS256';
const key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export type AccessTokenClaims = { sub: string; sid: string; role: Role };

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid, role: claims.role })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(key);
}

export type VerifyResult =
  { ok: true; claims: AccessTokenClaims } | { ok: false; reason: 'expired' | 'invalid' };

/** Verifies alg (HS256 only - never "none"), iss, aud, exp and required claims (requirements §3). */
export async function verifyAccessToken(token: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [ALGORITHM],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      requiredClaims: ['sub', 'sid', 'exp', 'iat'],
    });
    const { sub, sid, role } = payload as { sub?: unknown; sid?: unknown; role?: unknown };
    if (typeof sub !== 'string' || typeof sid !== 'string' || typeof role !== 'string') {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, claims: { sub, sid, role: role as Role } };
  } catch (err) {
    return { ok: false, reason: err instanceof errors.JWTExpired ? 'expired' : 'invalid' };
  }
}
