export type StoredFile = { key: string; url: string };

/** Object storage used for catalog images (requirements §4.2). Implementations: Cloudinary, memory (tests). */
export type StorageDriver = {
  /** Stores an already-processed image under a random name inside `folder`. */
  upload(data: Buffer, options: { folder: string; contentType: 'image/webp' }): Promise<StoredFile>;
  /** Deletes by key. Must not throw if the object no longer exists. */
  remove(key: string): Promise<void>;
};
