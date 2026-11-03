import { z } from 'zod';

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => /^postgres(ql)?:\/\//.test(value), 'must be a postgres:// connection string');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.url(),
  FRONTEND_URL: z.url(),
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(
          z.url().refine((origin) => origin !== '*' && new URL(origin).origin === origin, {
            message: 'each CORS origin must be an exact origin (scheme://host[:port]), no wildcard',
          }),
        )
        .min(1),
    ),
  COOKIE_DOMAIN: z.string().min(1),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: postgresUrl,
  DIRECT_URL: postgresUrl,

  REDIS_URL: z
    .string()
    .min(1)
    .refine((value) => /^rediss?:\/\//.test(value), 'must be a redis:// or rediss:// URL'),

  // Auth (requirements §3)
  JWT_ACCESS_SECRET: z.string().min(64, 'must be at least 64 characters (use 64 random bytes)'),
  JWT_ACCESS_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smh]$/, 'use a duration like 15m')
    .default('15m'),
  JWT_ISSUER: z.string().min(1).default('ecommerce-backend'),
  JWT_AUDIENCE: z.string().min(1).default('ecommerce-api'),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().min(7).max(30).default(14),
  ADMIN_REFRESH_TOKEN_EXPIRES_HOURS: z.coerce.number().int().min(1).max(24).default(12),
  CSRF_SECRET: z.string().min(32, 'must be at least 32 characters'),
  TOTP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 32 bytes as 64 hex characters'),
  TOTP_ISSUER: z.string().min(1).default('Store'),
  TURNSTILE_SECRET_KEY: optionalString,
  MAIL_FROM: optionalString,
  RESEND_API_KEY: optionalString,
  STORAGE_BUCKET: optionalString,
  PAYMENT_PROVIDER: optionalString,
  SEED_SUPER_ADMIN_EMAIL: optionalString,
  SEED_SUPER_ADMIN_PASSWORD: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Only variable names and messages are printed - never values.
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = result.data;
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (env.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
      problems.push('CORS_ORIGINS: must be https in production');
    }
    if (!env.TURNSTILE_SECRET_KEY) problems.push('TURNSTILE_SECRET_KEY: required in production');
    if (!env.RESEND_API_KEY) problems.push('RESEND_API_KEY: required in production');
    if (!env.MAIL_FROM) problems.push('MAIL_FROM: required in production');
    if (problems.length > 0) {
      throw new Error(
        `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
      );
    }
  }
  return env;
}

export const env: Env = parseEnv(process.env);
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
