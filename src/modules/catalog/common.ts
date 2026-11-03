import { randomBytes } from 'node:crypto';

import { Role } from '@prisma/client';
import { z } from 'zod';

import { processImage } from '../../lib/images.js';
import { storage } from '../../lib/storage/index.js';
import { requireReauth, requireRole } from '../../middlewares/rbac.js';
import { ApiError } from '../../utils/ApiError.js';
import { slugSchemaPattern } from '../../utils/slug.js';

import type { RequestHandler } from 'express';

export const idParamsSchema = z.object({ id: z.uuid() });

export const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .regex(slugSchemaPattern, 'Use lowercase letters, numbers and single hyphens');

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/**
 * Deleting catalog data is a sensitive action (requirements §3): ADMIN or SUPER_ADMIN only, with a
 * recent POST /auth/reauth. (Creating/editing is allowed for STAFF.)
 */
export const canDelete: RequestHandler[] = [
  requireRole(Role.ADMIN, Role.SUPER_ADMIN),
  requireReauth,
];

/**
 * Soft-deleted rows keep their data, but their unique slug/SKU is renamed so it can be reused.
 * e.g. "red-shirt" → "red-shirt--deleted-1a2b3c4d"
 */
export function retiredUnique(value: string, max: number): string {
  const suffix = `--deleted-${randomBytes(4).toString('hex')}`;
  return `${value.slice(0, max - suffix.length)}${suffix}`;
}

/** Request-scoped uploaded file from multer (memory storage). */
export type UploadedFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };

export function requireUploadedFile(file: UploadedFile | undefined): UploadedFile {
  if (!file) throw new ApiError(400, 'FILE_REQUIRED', 'Attach an image in the "image" field');
  return file;
}

/** Validates + re-encodes one image and stores it. */
export async function storeImage(file: UploadedFile, folder: string) {
  const image = await processImage(file.buffer);
  const stored = await storage.upload(image.data, { folder, contentType: image.contentType });
  return { ...stored, width: image.width, height: image.height };
}
