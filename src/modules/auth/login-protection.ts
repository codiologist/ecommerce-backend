import { sha256 } from '../../lib/crypto.js';
import { redis } from '../../lib/redis.js';

/**
 * Per-account brute-force protection (requirements §3), keyed by a hash of the email so it behaves
 * identically for existing and non-existing accounts (no enumeration).
 *  - progressive delay after each failure (capped)
 *  - CAPTCHA (Turnstile) required after CAPTCHA_AFTER failures
 *  - temporary lockout after LOCK_AFTER failures
 */
/** Mutable so tests can shorten the delays; never changed at runtime. */
export const LOGIN_PROTECTION: {
  windowSeconds: number;
  captchaAfter: number;
  lockAfter: number;
  lockSeconds: number;
  baseDelayMs: number;
  maxDelayMs: number;
} = {
  windowSeconds: 15 * 60,
  captchaAfter: 3,
  lockAfter: 10,
  lockSeconds: 15 * 60,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
};

const failuresKey = (email: string) => `login:fail:${sha256(email)}`;
const lockKey = (email: string) => `login:lock:${sha256(email)}`;

export type LoginGate = { locked: boolean; retryAfterSeconds: number; captchaRequired: boolean };

export const loginProtection = {
  async check(email: string): Promise<LoginGate> {
    const [lockTtl, failures] = await Promise.all([
      redis.ttl(lockKey(email)),
      redis.get(failuresKey(email)),
    ]);
    const count = Number(failures ?? 0);
    return {
      locked: lockTtl > 0,
      retryAfterSeconds: Math.max(lockTtl, 0),
      captchaRequired: count >= LOGIN_PROTECTION.captchaAfter,
    };
  },

  /** Records a failure. Returns the delay to apply and whether this failure triggered a lockout. */
  async recordFailure(
    email: string,
  ): Promise<{ delayMs: number; lockedNow: boolean; failures: number }> {
    const key = failuresKey(email);
    const [[, count]] = (await redis
      .multi()
      .incr(key)
      .expire(key, LOGIN_PROTECTION.windowSeconds, 'NX')
      .exec()) as [[null, number], [null, number]];

    let lockedNow = false;
    if (count >= LOGIN_PROTECTION.lockAfter) {
      const set = await redis.set(lockKey(email), '1', 'EX', LOGIN_PROTECTION.lockSeconds, 'NX');
      lockedNow = set === 'OK';
    }
    const delayMs = Math.min(
      LOGIN_PROTECTION.baseDelayMs * 2 ** Math.max(count - 1, 0),
      LOGIN_PROTECTION.maxDelayMs,
    );
    return { delayMs, lockedNow, failures: count };
  },

  async reset(email: string): Promise<void> {
    await redis.del(failuresKey(email), lockKey(email));
  },
};
