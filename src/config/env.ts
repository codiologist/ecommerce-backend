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

  // Used from Phase 1 onward; optional for now.
  REDIS_URL: optionalString,
  JWT_ACCESS_SECRET: optionalString,
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().min(7).max(30).default(14),
  CSRF_SECRET: optionalString,
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
    const insecure = env.CORS_ORIGINS.filter((origin) => !origin.startsWith('https://'));
    if (insecure.length > 0) {
      throw new Error(
        'Invalid environment configuration:\n  - CORS_ORIGINS: must be https in production',
      );
    }
  }
  return env;
}

export const env: Env = parseEnv(process.env);
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
