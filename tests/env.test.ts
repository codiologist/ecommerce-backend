import { describe, expect, it } from 'vitest';

import { parseEnv } from '../src/config/env.js';

const valid = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:4000',
  FRONTEND_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000, http://localhost:3001',
  COOKIE_DOMAIN: 'localhost',
  DATABASE_URL: 'postgresql://u:p@localhost:6543/postgres?pgbouncer=true',
  DIRECT_URL: 'postgresql://u:p@localhost:5432/postgres',
};

describe('parseEnv', () => {
  it('parses a valid config and applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
    expect(env.REDIS_URL).toBeUndefined();
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

  it('requires https CORS origins in production', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/https/);
    expect(() =>
      parseEnv({ ...valid, NODE_ENV: 'production', CORS_ORIGINS: 'https://example.com' }),
    ).not.toThrow();
  });

  it('rejects non-postgres database URLs', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(/DATABASE_URL/);
  });
});
