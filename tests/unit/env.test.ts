import { describe, expect, it } from 'vitest';

import { parseEnv } from '../../src/config/env.js';

const valid = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:4000',
  FRONTEND_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000, http://localhost:3001',
  COOKIE_DOMAIN: 'localhost',
  DATABASE_URL: 'postgresql://u:p@localhost:6543/postgres?pgbouncer=true',
  DIRECT_URL: 'postgresql://u:p@localhost:5432/postgres',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: 'j'.repeat(64),
  CSRF_SECRET: 'c'.repeat(32),
  TOTP_ENCRYPTION_KEY: 'f'.repeat(64),
};

const prodExtras = {
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://example.com',
  TURNSTILE_SECRET_KEY: 'x',
  SMTP_HOST: 'smtp.example.com',
  MAIL_FROM: 'Store <no-reply@example.com>',
};

describe('parseEnv', () => {
  it('parses a valid config and applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
    expect(env.TURNSTILE_SECRET_KEY).toBeUndefined();
    expect(env.REFRESH_TOKEN_EXPIRES_DAYS).toBe(14);
    expect(env.ADMIN_REFRESH_TOKEN_EXPIRES_HOURS).toBe(12);
  });

  it('refuses to start when required vars are missing, without printing values', () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    expect(() =>
      parseEnv({ ...rest, DIRECT_URL: 'postgresql://secret-user:secret-pass@h/db' }),
    ).toThrow(/DATABASE_URL/);
    try {
      parseEnv({ ...rest, DIRECT_URL: 'postgresql://secret-user:secret-pass@h/db' });
    } catch (err) {
      expect(String(err)).not.toContain('secret-pass');
    }
  });

  it('rejects wildcard CORS origins', () => {
    expect(() => parseEnv({ ...valid, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
  });

  it('rejects origins with a path', () => {
    expect(() => parseEnv({ ...valid, CORS_ORIGINS: 'http://localhost:3000/app' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('requires https CORS origins and production-only secrets in production', () => {
    expect(() =>
      parseEnv({ ...valid, ...prodExtras, CORS_ORIGINS: 'http://localhost:3000' }),
    ).toThrow(/https/);
    expect(() => parseEnv({ ...valid, ...prodExtras, TURNSTILE_SECRET_KEY: '' })).toThrow(
      /TURNSTILE/,
    );
    expect(() => parseEnv({ ...valid, ...prodExtras, SMTP_HOST: '' })).toThrow(/SMTP_HOST/);
    expect(() => parseEnv({ ...valid, ...prodExtras, SMTP_USER: 'u' })).toThrow(/SMTP_USER/);
    expect(() => parseEnv({ ...valid, ...prodExtras })).not.toThrow();
  });

  it('enforces strong auth secrets', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv({ ...valid, TOTP_ENCRYPTION_KEY: 'nothex' })).toThrow(
      /TOTP_ENCRYPTION_KEY/,
    );
    expect(() => parseEnv({ ...valid, REDIS_URL: 'http://x' })).toThrow(/REDIS_URL/);
  });

  it('rejects non-postgres database URLs', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(/DATABASE_URL/);
  });
});
