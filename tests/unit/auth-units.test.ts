import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { decrypt, encrypt, randomToken, safeEqual, sha256 } from '../../src/lib/crypto.js';
import { signAccessToken, verifyAccessToken } from '../../src/modules/auth/jwt.js';
import {
  checkPasswordPolicy,
  hashPassword,
  verifyPassword,
} from '../../src/modules/auth/password.js';
import { backupCodes } from '../../src/modules/auth/two-factor.js';

const KEY = 'a'.repeat(64);

describe('crypto', () => {
  it('encrypts with AES-256-GCM and detects tampering', () => {
    const payload = encrypt('JBSWY3DPEHPK3PXP', KEY);
    expect(payload).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decrypt(payload, KEY)).toBe('JBSWY3DPEHPK3PXP');
    expect(encrypt('same', KEY)).not.toBe(encrypt('same', KEY)); // random IV

    const [iv, tag, data] = payload.split('.');
    const flipped = `${iv}.${tag}.${(data ?? '').slice(0, -2)}AA`;
    expect(() => decrypt(flipped, KEY)).toThrow();
    expect(() => decrypt(payload, 'b'.repeat(64))).toThrow();
  });

  it('generates 256-bit url-safe tokens', () => {
    const token = randomToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('compares safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(sha256('x')).toHaveLength(64);
  });
});

describe('password policy', () => {
  it.each([
    ['short', 'Ab1!x', /at least 8/],
    ['too long', 'a'.repeat(129), /at most 128/],
    ['common', 'Password1', /too common/],
    ['repeated', 'zzzzzzzzzz', /common|repeated/],
  ])('rejects %s passwords', (_l, password, message) => {
    expect(checkPasswordPolicy(password)).toMatch(message);
  });

  it('rejects passwords containing the email local part', () => {
    expect(checkPasswordPolicy('my-rahim2024-pass', { email: 'rahim2024@example.com' })).toMatch(
      /email/,
    );
  });

  it('accepts a strong password', () => {
    expect(checkPasswordPolicy('Correct-Horse-Battery-42', { email: 'a@b.co' })).toBeNull();
  });

  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-42');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(await verifyPassword(hash, 'Correct-Horse-Battery-42')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('access tokens', () => {
  it('round-trips claims', async () => {
    const token = await signAccessToken({ sub: 'u1', sid: 's1', role: 'CUSTOMER' });
    const result = await verifyAccessToken(token);
    expect(result).toEqual({ ok: true, claims: { sub: 'u1', sid: 's1', role: 'CUSTOMER' } });
  });

  it('rejects wrong secret, wrong audience, missing claims and expiry', async () => {
    const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);
    const base = () =>
      new SignJWT({ sid: 's', role: 'ADMIN' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('u')
        .setIssuer('ecommerce-backend')
        .setIssuedAt();

    const wrongAud = await base().setAudience('other').setExpirationTime('5m').sign(secret);
    const expired = await base()
      .setAudience('ecommerce-api')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(secret);
    const noExp = await base().setAudience('ecommerce-api').sign(secret);
    const wrongKey = await base()
      .setAudience('ecommerce-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('z'.repeat(80)));

    expect(await verifyAccessToken(wrongAud)).toEqual({ ok: false, reason: 'invalid' });
    expect(await verifyAccessToken(expired)).toEqual({ ok: false, reason: 'expired' });
    expect(await verifyAccessToken(noExp)).toEqual({ ok: false, reason: 'invalid' });
    expect(await verifyAccessToken(wrongKey)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('backup codes', () => {
  it('generates 10 unique codes and hashes them case/format-insensitively', () => {
    const { codes, hashes } = backupCodes.generate();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    const first = codes[0] ?? '';
    expect(backupCodes.hash(first.toUpperCase().replace('-', ''))).toBe(hashes[0]);
  });
});
