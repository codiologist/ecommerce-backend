import { randomUUID } from 'node:crypto';

import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

import type { StorageDriver } from './types.js';

export function createCloudinaryDriver(config: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  rootFolder: string;
}): StorageDriver {
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });

  return {
    upload(data, { folder }) {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `${config.rootFolder}/${folder}`,
            public_id: randomUUID(), // random names, never the client's filename (§4.2)
            resource_type: 'image',
            type: 'upload',
            overwrite: false,
            unique_filename: false,
            format: 'webp',
          },
          (error, result?: UploadApiResponse) => {
            if (error || !result) {
              reject(new Error(`Cloudinary upload failed: ${error?.message ?? 'no result'}`));
              return;
            }
            resolve({ key: result.public_id, url: result.secure_url });
          },
        );
        stream.end(data);
      });
    },
    async remove(key) {
      // "not found" is reported in the result, not thrown - which is what we want.
      await cloudinary.uploader.destroy(key, { resource_type: 'image', invalidate: true });
    },
  };
}
