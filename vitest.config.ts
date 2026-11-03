import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against the LOCAL Docker Postgres + Redis (docker-compose.yml), never Supabase
 * (requirements §9). tests/global-setup.ts refuses to run against a non-local database.
 */
const TEST_DB =
  'postgresql://ecommerce:ecommerce_local_only@127.0.0.1:54329/ecommerce_test?schema=app';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    restoreMocks: true,
    // One shared test database: run files sequentially.
    fileParallelism: false,
    globalSetup: ['./tests/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      PORT: '4000',
      APP_URL: 'http://localhost:4000',
      FRONTEND_URL: 'http://localhost:3000',
      CORS_ORIGINS: 'http://localhost:3000',
      COOKIE_DOMAIN: 'localhost',
      DATABASE_URL: TEST_DB,
      DIRECT_URL: TEST_DB,
      REDIS_URL: 'redis://127.0.0.1:63799/1',
      // Test-only secrets (not used anywhere else).
      JWT_ACCESS_SECRET: 'test-jwt-secret-'.padEnd(80, 'x'),
      CSRF_SECRET: 'test-csrf-secret-'.padEnd(48, 'y'),
      TOTP_ENCRYPTION_KEY: '0'.repeat(63) + '1',
      TURNSTILE_SECRET_KEY: '',
    },
  },
});
