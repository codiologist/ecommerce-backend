import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    restoreMocks: true,
    // Test env only - never point tests at the production Supabase database (§9).
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      PORT: '4000',
      APP_URL: 'http://localhost:4000',
      FRONTEND_URL: 'http://localhost:3000',
      CORS_ORIGINS: 'http://localhost:3000',
      COOKIE_DOMAIN: 'localhost',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/ecommerce_test?schema=app',
      DIRECT_URL: 'postgresql://test:test@localhost:5432/ecommerce_test?schema=app',
    },
  },
});
