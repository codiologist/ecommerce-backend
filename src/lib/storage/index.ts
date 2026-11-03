import { env, isTest } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../logger.js';

import { createCloudinaryDriver } from './cloudinary.js';
import { createMemoryDriver } from './memory.js';

import type { StorageDriver } from './types.js';

export type { StorageDriver, StoredFile } from './types.js';

/** Development without Cloudinary credentials: uploads fail with a clear 503 instead of silently. */
const unconfigured: StorageDriver = {
  upload: () =>
    Promise.reject(
      new ApiError(503, 'STORAGE_NOT_CONFIGURED', 'Image storage is not configured on the server', {
        expose: true,
      }),
    ),
  remove: () => Promise.resolve(),
};

function createDriver(): StorageDriver {
  if (isTest) return createMemoryDriver();
  if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
    return createCloudinaryDriver({
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
      rootFolder: env.CLOUDINARY_FOLDER,
    });
  }
  logger.warn('Cloudinary is not configured - image uploads will return 503 (development only)');
  return unconfigured;
}

export const storage: StorageDriver = createDriver();

/** Best-effort delete (used after DB rows are gone); failures are logged, never thrown. */
export async function removeStoredFile(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await storage.remove(key);
  } catch (err) {
    logger.error({ err, key }, 'Failed to delete stored file');
  }
}
