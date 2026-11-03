import { randomUUID } from 'node:crypto';

import type { StorageDriver } from './types.js';

/** In-memory storage for tests: lets tests inspect exactly what was stored. */
export function createMemoryDriver(): StorageDriver & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    upload(data, { folder }) {
      const key = `${folder}/${randomUUID()}`;
      files.set(key, data);
      return Promise.resolve({ key, url: `https://storage.test/${key}.webp` });
    },
    remove(key) {
      files.delete(key);
      return Promise.resolve();
    },
  };
}
