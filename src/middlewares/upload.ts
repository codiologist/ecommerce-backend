import multer, { MulterError } from 'multer';

import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '../lib/images.js';
import { ApiError } from '../utils/ApiError.js';

import type { RequestHandler } from 'express';

/**
 * Multipart image upload (admin only - mounted behind the admin router).
 * Memory storage only: files never touch the API server's disk (requirements §4.2).
 * The declared MIME type is a first filter; the real type is checked from magic bytes in processImage().
 */
function imageUpload(field: string, maxFiles: number): RequestHandler {
  const handler = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: maxFiles, fields: 10, parts: maxFiles + 10 },
    fileFilter: (_req, file, cb) => {
      if ((ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.mimetype)) cb(null, true);
      else cb(ApiError.unsupportedMediaType('Only JPEG, PNG, WebP or AVIF images are allowed'));
    },
  });
  const middleware = maxFiles === 1 ? handler.single(field) : handler.array(field, maxFiles);

  return (req, res, next) => {
    middleware(req, res, (err: unknown) => {
      if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          next(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Each image must be 5 MB or smaller'));
          return;
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          next(
            ApiError.badRequest(
              `Upload at most ${maxFiles} image(s) in the "${field}" field`,
              'TOO_MANY_FILES',
            ),
          );
          return;
        }
        next(ApiError.badRequest('Invalid upload', 'INVALID_UPLOAD'));
        return;
      }
      next(err);
    });
  };
}

export const uploadSingleImage = imageUpload('image', 1);
export const uploadProductImages = imageUpload('images', 10);
