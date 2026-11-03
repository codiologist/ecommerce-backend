import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z, type ZodType } from 'zod';

import { API_PREFIX } from '../config/constants.js';
import {
  createAttributeSchema,
  createAttributeValueSchema,
  updateAttributeSchema,
  updateAttributeValueSchema,
} from '../modules/attributes/attributes.schema.js';
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
import {
  createBrandSchema,
  listBrandsQuerySchema,
  updateBrandSchema,
} from '../modules/brands/brands.schema.js';
import {
  createCategorySchema,
  reorderCategoriesSchema,
  updateCategorySchema,
} from '../modules/categories/categories.schema.js';
import { stockAdjustmentSchema } from '../modules/inventory/inventory.schema.js';
import {
  bulkProductsSchema,
  createProductSchema,
  createVariantSchema,
  listProductsQuerySchema,
  reorderImagesSchema,
  updateImageSchema,
  updateProductSchema,
  updateVariantSchema,
} from '../modules/products/products.schema.js';
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
  query?: z.ZodObject;
  /** multipart/form-data upload: field name, and whether several files are accepted. */
  multipart?: { field: string; multiple: boolean };
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
    ...(spec.body || spec.query || spec.multipart
      ? {
          request: {
            ...(spec.body ? { body: json(spec.body) } : {}),
            ...(spec.query ? { query: spec.query } : {}),
            ...(spec.multipart
              ? {
                  body: {
                    content: {
                      'multipart/form-data': {
                        schema: z.object({
                          [spec.multipart.field]: spec.multipart.multiple
                            ? z.array(z.string().describe('binary image file')).max(10)
                            : z.string().describe('binary image file'),
                        }),
                      },
                    },
                  },
                }
              : {}),
          },
        }
      : {}),
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

// ---------------------------------------------------------------------------
// Phase 2 - Catalog (admin). Deletes need ADMIN/SUPER_ADMIN + a recent POST /auth/reauth.
// ---------------------------------------------------------------------------
const anyData = z.unknown();
const catalog: PathSpec[] = [
  {
    method: 'get',
    path: '/admin/categories',
    tag: 'catalog',
    summary: 'Category list + tree',
    ok: { status: 200, data: anyData },
  },
  {
    method: 'post',
    path: '/admin/categories',
    tag: 'catalog',
    summary: 'Create category',
    body: createCategorySchema,
    ok: { status: 201, data: anyData },
  },
  {
    method: 'patch',
    path: '/admin/categories/reorder',
    tag: 'catalog',
    summary: 'Reorder categories',
    body: reorderCategoriesSchema,
    ok: { status: 204 },
  },
  {
    method: 'get',
    path: '/admin/categories/{id}',
    tag: 'catalog',
    summary: 'Get category',
    ok: { status: 200, data: anyData },
  },
  {
    method: 'patch',
    path: '/admin/categories/{id}',
    tag: 'catalog',
    summary: 'Update category',
    body: updateCategorySchema,
    ok: { status: 200, data: anyData },
  },
  {
    method: 'delete',
    path: '/admin/categories/{id}',
    tag: 'catalog',
    summary: 'Delete category (ADMIN + reauth)',
    ok: { status: 204 },
  },
  {
    method: 'post',
    path: '/admin/categories/{id}/image',
    tag: 'catalog',
    summary: 'Upload category image',
    multipart: { field: 'image', multiple: false },
    ok: { status: 200, data: anyData },
  },
  {
    method: 'delete',
    path: '/admin/categories/{id}/image',
    tag: 'catalog',
    summary: 'Remove category image',
    ok: { status: 200, data: anyData },
  },
  {
    method: 'get',
    path: '/admin/brands',
    tag: 'catalog',
    summary: 'List brands (offset pagination)',
    query: listBrandsQuerySchema,
    ok: { status: 200, data: anyData },
  },
  {
    method: 'post',
    path: '/admin/brands',
    tag: 'catalog',
    summary: 'Create brand',
    body: createBrandSchema,
    ok: { status: 201, data: anyData },
  },
  {
    method: 'get',
    path: '/admin/brands/{id}',
    tag: 'catalog',
    summary: 'Get brand',
    ok: { status: 200, data: anyData },
  },
  {
    method: 'patch',
    path: '/admin/brands/{id}',
    tag: 'catalog',
    summary: 'Update brand',
    body: updateBrandSchema,
    ok: { status: 200, data: anyData },
  },
  {
    method: 'delete',
    path: '/admin/brands/{id}',
    tag: 'catalog',
    summary: 'Delete brand (ADMIN + reauth)',
    ok: { status: 204 },
  },
  {
    method: 'post',
    path: '/admin/brands/{id}/logo',
    tag: 'catalog',
    summary: 'Upload brand logo',
    multipart: { field: 'image', multiple: false },
    ok: { status: 200, data: anyData },
  },
  {
    method: 'delete',
    path: '/admin/brands/{id}/logo',
    tag: 'catalog',
    summary: 'Remove brand logo',
    ok: { status: 200, data: anyData },
  },
  {
    method: 'get',
    path: '/admin/attributes',
    tag: 'catalog',
    summary: 'Attributes with values',
    ok: { status: 200, data: anyData },
  },
  {
    method: 'post',
    path: '/admin/attributes',
    tag: 'catalog',
    summary: 'Create attribute',
    body: createAttributeSchema,
    ok: { status: 201, data: anyData },
  },
  {
    method: 'patch',
    path: '/admin/attributes/{id}',
    tag: 'catalog',
    summary: 'Update attribute',
    body: updateAttributeSchema,
    ok: { status: 200, data: anyData },
  },
  {
    method: 'delete',
    path: '/admin/attributes/{id}',
    tag: 'catalog',
    summary: 'Delete attribute (ADMIN + reauth)',
    ok: { status: 204 },
  },
  {
    method: 'post',
    path: '/admin/attributes/{id}/values',
    tag: 'catalog',
    summary: 'Add attribute value',
    body: createAttributeValueSchema,
    ok: { status: 201, data: anyData },
  },
  {
    method: 'patch',
    path: '/admin/attributes/values/{valueId}',
    tag: 'catalog',
    summary: 'Update attribute value',
    body: updateAttributeValueSchema,
    ok: { status: 200, data: anyData },
  },
  {
    method: 'delete',
    path: '/admin/attributes/values/{valueId}',
    tag: 'catalog',
    summary: 'Delete attribute value (ADMIN + reauth)',
    ok: { status: 204 },
  },
  {
    method: 'get',
    path: '/admin/products',
    tag: 'catalog',
    summary: 'List products (filters, search, offset pagination)',
    query: listProductsQuerySchema,
    ok: { status: 200, data: anyData },
  },
  {
    method: 'post',
    path: '/admin/products',
    tag: 'catalog',
    summary: 'Create product with variants',
    body: createProductSchema,
    ok: { status: 201, data: anyData },
  },
  {
    method: 'post',
    path: '/admin/products/bulk',
    tag: 'catalog',
    summary: 'Bulk publish/draft/archive/delete',
    body: bulkProductsSchema,
    ok: { status: 200, data: anyData },
  },
  {
    method: 'get',
    path: '/admin/products/{id}',
    tag: 'catalog',
    summary: 'Product detail',
    ok: { status: 200, data: anyData },
  },
  {
    method: 'patch',
    path: '/admin/products/{id}',
    tag: 'catalog',
    summary: 'Update product fields',
    body: updateProductSchema,
    ok: { status: 200, data: anyData },
  },
  {
    method: 'delete',
    path: '/admin/products/{id}',
    tag: 'catalog',
    summary: 'Delete product (ADMIN + reauth)',
    ok: { status: 204 },
  },
  {
    method: 'post',
    path: '/admin/products/{id}/variants',
    tag: 'catalog',
    summary: 'Add variant',
    body: createVariantSchema,
    ok: { status: 201, data: anyData },
  },
  {
    method: 'patch',
    path: '/admin/variants/{variantId}',
    tag: 'catalog',
    summary: 'Update variant (not stock)',
    body: updateVariantSchema,
    ok: { status: 200, data: anyData },
  },
  {
    method: 'delete',
    path: '/admin/variants/{variantId}',
    tag: 'catalog',
    summary: 'Delete variant (ADMIN + reauth)',
    ok: { status: 204 },
  },
  {
    method: 'post',
    path: '/admin/products/{id}/images',
    tag: 'catalog',
    summary: 'Upload product images (max 10 per request, 20 per product)',
    multipart: { field: 'images', multiple: true },
    ok: { status: 201, data: anyData },
  },
  {
    method: 'patch',
    path: '/admin/products/{id}/images/order',
    tag: 'catalog',
    summary: 'Reorder product images',
    body: reorderImagesSchema,
    ok: { status: 200, data: anyData },
  },
  {
    method: 'patch',
    path: '/admin/images/{imageId}',
    tag: 'catalog',
    summary: 'Update image alt / variant',
    body: updateImageSchema,
    ok: { status: 200, data: anyData },
  },
  {
    method: 'delete',
    path: '/admin/images/{imageId}',
    tag: 'catalog',
    summary: 'Delete image',
    ok: { status: 204 },
  },
  {
    method: 'post',
    path: '/admin/variants/{variantId}/stock-adjustments',
    tag: 'inventory',
    summary: 'Adjust stock (atomic, never negative)',
    body: stockAdjustmentSchema,
    ok: { status: 201, data: anyData },
  },
  {
    method: 'get',
    path: '/admin/variants/{variantId}/movements',
    tag: 'inventory',
    summary: 'Stock movement history',
    ok: { status: 200, data: anyData },
  },
  {
    method: 'get',
    path: '/admin/inventory/low-stock',
    tag: 'inventory',
    summary: 'Variants at or below their threshold',
    ok: { status: 200, data: anyData },
  },
];
for (const spec of catalog) add({ ...spec, auth: true });

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'E-commerce API', version: '1.0.0' },
  });
}
