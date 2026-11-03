import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

import { ApiError } from '../utils/ApiError.js';

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 8000 * 8000;
const MAX_OUTPUT_WIDTH = 2000;

export type ProcessedImage = {
  data: Buffer;
  width: number;
  height: number;
  contentType: 'image/webp';
};

/**
 * Upload hardening (requirements §4.2):
 * 1. checks the real type from magic bytes (the client's Content-Type/extension is not trusted),
 * 2. re-encodes to WebP with sharp: drops EXIF/GPS and any appended payload, bounds the size.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const detected = await fileTypeFromBuffer(input);
  if (!detected || !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(detected.mime)) {
    throw ApiError.unsupportedMediaType('Only JPEG, PNG, WebP or AVIF images are allowed');
  }
  try {
    const { data, info } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
    })
      .rotate() // apply EXIF orientation before metadata is dropped
      .resize({ width: MAX_OUTPUT_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true }); // sharp drops all metadata unless asked to keep it
    return { data, width: info.width, height: info.height, contentType: 'image/webp' };
  } catch (err) {
    throw new ApiError(400, 'INVALID_IMAGE', 'The image could not be processed', { cause: err });
  }
}
