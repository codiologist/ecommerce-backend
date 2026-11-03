import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z, type ZodType } from 'zod';

import { API_PREFIX } from '../config/constants.js';
import {
  emailOnlySchema,
  enableTwoFactorSchema,
  loginSchema,
  loginTwoFactorSchema,
  reauthSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
} from '../modules/auth/auth.schema.js';
import { changePasswordSchema, updateMeSchema } from '../modules/users/users.schema.js';

/**
 * OpenAPI 3.1 document generated from the same Zod schemas the routes validate with (requirements §6).
 * Served at /api/docs in non-production only.
 */
const registry = new OpenAPIRegistry();

const errorEnvelope = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string().optional(), message: z.string() })).optional(),
    requestId: z.string(),
  }),
});
const success = (data: ZodType) => z.object({ success: z.literal(true), data });

const publicUser = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  phone: z.string().nullable(),
  role: z.enum(['CUSTOMER', 'STAFF', 'ADMIN', 'SUPER_ADMIN']),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  createdAt: z.iso.datetime(),
});
const message = z.object({ message: z.string() });

type Method = 'get' | 'post' | 'patch' | 'delete';
type PathSpec = {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  body?: ZodType;
  ok: { status: number; data?: ZodType };
  auth?: boolean;
};

const json = (schema: ZodType) => ({ content: { 'application/json': { schema } } });

function add(spec: PathSpec): void {
  const responses: Record<
    string,
    { description: string; content?: ReturnType<typeof json>['content'] }
  > = {
    [spec.ok.status]: spec.ok.data
      ? { description: 'Success', ...json(success(spec.ok.data)) }
      : { description: 'Success (no content)' },
    default: { description: 'Error', ...json(errorEnvelope) },
  };
  registry.registerPath({
    method: spec.method,
    path: `${API_PREFIX}${spec.path}`,
    tags: [spec.tag],
    summary: spec.summary,
    ...(spec.auth ? { security: [{ cookieAuth: [] }] } : {}),
    ...(spec.body ? { request: { body: json(spec.body) } } : {}),
    responses,
  });
}

registry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'access_token',
  description:
    'HttpOnly access-token cookie (`__Secure-access_token` in production). Every non-GET request also needs the `X-CSRF-Token` header (value of the `csrf_token` cookie from GET /auth/csrf).',
});

add({
  method: 'get',
  path: '/health',
  tag: 'health',
  summary: 'Health check',
  ok: { status: 200, data: z.object({ status: z.enum(['ok', 'degraded']) }) },
});

add({
  method: 'get',
  path: '/auth/csrf',
  tag: 'auth',
  summary: 'Issue CSRF token cookie',
  ok: { status: 200, data: z.object({ csrfToken: z.string() }) },
});
add({
  method: 'post',
  path: '/auth/register',
  tag: 'auth',
  summary: 'Register (same response whether or not the email exists)',
  body: registerSchema,
  ok: { status: 201, data: message },
});
add({
  method: 'post',
  path: '/auth/verify-email',
  tag: 'auth',
  summary: 'Verify email with token',
  body: tokenSchema,
  ok: { status: 200, data: message },
});
add({
  method: 'post',
  path: '/auth/resend-verification',
  tag: 'auth',
  summary: 'Resend verification email',
  body: emailOnlySchema,
  ok: { status: 202, data: message },
});
add({
  method: 'post',
  path: '/auth/login',
  tag: 'auth',
  summary: 'Log in (sets cookies) or start a 2FA challenge',
  body: loginSchema,
  ok: {
    status: 200,
    data: z.union([
      z.object({ twoFactorRequired: z.literal(false), user: publicUser }),
      z.object({ twoFactorRequired: z.literal(true), challengeId: z.string() }),
    ]),
  },
});
add({
  method: 'post',
  path: '/auth/login/2fa',
  tag: 'auth',
  summary: 'Complete login with TOTP or backup code',
  body: loginTwoFactorSchema,
  ok: { status: 200, data: z.object({ twoFactorRequired: z.literal(false), user: publicUser }) },
});
add({
  method: 'post',
  path: '/auth/refresh',
  tag: 'auth',
  summary: 'Rotate refresh token, issue new access token',
  ok: { status: 204 },
});
add({
  method: 'post',
  path: '/auth/logout',
  tag: 'auth',
  summary: 'Log out this session',
  ok: { status: 204 },
});
add({
  method: 'post',
  path: '/auth/logout-all',
  tag: 'auth',
  summary: 'Log out of all devices',
  auth: true,
  ok: { status: 204 },
});
add({
  method: 'post',
  path: '/auth/forgot-password',
  tag: 'auth',
  summary: 'Request password reset email',
  body: emailOnlySchema,
  ok: { status: 202, data: message },
});
add({
  method: 'post',
  path: '/auth/reset-password',
  tag: 'auth',
  summary: 'Reset password with token (revokes all sessions)',
  body: resetPasswordSchema,
  ok: { status: 200, data: message },
});
add({
  method: 'post',
  path: '/auth/reauth',
  tag: 'auth',
  summary: 'Re-authenticate for sensitive actions (valid 5 min)',
  auth: true,
  body: reauthSchema,
  ok: { status: 204 },
});
add({
  method: 'post',
  path: '/auth/2fa/setup',
  tag: '2fa',
  summary: 'Start TOTP setup',
  auth: true,
  ok: {
    status: 200,
    data: z.object({ otpauthUri: z.string(), qrCodeDataUrl: z.string(), secret: z.string() }),
  },
});
add({
  method: 'post',
  path: '/auth/2fa/enable',
  tag: '2fa',
  summary: 'Confirm TOTP setup, returns backup codes once',
  auth: true,
  body: enableTwoFactorSchema,
  ok: { status: 200, data: z.object({ backupCodes: z.array(z.string()) }) },
});
add({
  method: 'post',
  path: '/auth/2fa/disable',
  tag: '2fa',
  summary: 'Disable 2FA (needs reauth; not allowed for staff)',
  auth: true,
  ok: { status: 204 },
});

const sessionView = z.object({
  id: z.uuid(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  current: z.boolean(),
});
add({
  method: 'get',
  path: '/users/me',
  tag: 'users',
  summary: 'Current user',
  auth: true,
  ok: { status: 200, data: publicUser },
});
add({
  method: 'patch',
  path: '/users/me',
  tag: 'users',
  summary: 'Update profile',
  auth: true,
  body: updateMeSchema,
  ok: { status: 200, data: publicUser },
});
add({
  method: 'post',
  path: '/users/me/change-password',
  tag: 'users',
  summary: 'Change password (revokes other sessions)',
  auth: true,
  body: changePasswordSchema,
  ok: { status: 204 },
});
add({
  method: 'get',
  path: '/users/me/sessions',
  tag: 'users',
  summary: 'Active sessions',
  auth: true,
  ok: { status: 200, data: z.array(sessionView) },
});
add({
  method: 'delete',
  path: '/users/me/sessions/{id}',
  tag: 'users',
  summary: 'Revoke a session',
  auth: true,
  ok: { status: 204 },
});

add({
  method: 'get',
  path: '/admin/session',
  tag: 'admin',
  summary: 'Admin access check (staff+, 2FA)',
  auth: true,
  ok: {
    status: 200,
    data: z.object({ userId: z.uuid(), role: z.string(), twoFactorVerified: z.boolean() }),
  },
});

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'E-commerce API', version: '1.0.0' },
  });
}
