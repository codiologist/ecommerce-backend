import { audit } from '../../lib/audit.js';
import { processImage, type ProcessedImage } from '../../lib/images.js';
import { prisma } from '../../lib/prisma.js';
import { removeStoredFile, storage, type StoredFile } from '../../lib/storage/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { defined } from '../../utils/object.js';

import { productsRepository } from './products.repository.js';
import { toImageView, type ImageView } from './products.views.js';

import type { UploadedFile } from '../catalog/common.js';
import type { Request } from 'express';

const MAX_IMAGES_PER_PRODUCT = 20;
const actor = (req: Request) => req.auth?.userId ?? null;

const listImages = async (productId: string): Promise<ImageView[]> =>
  (
    await prisma.productImage.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  ).map(toImageView);

async function getImageOrThrow(imageId: string) {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, product: { deletedAt: null } },
  });
  if (!image) throw ApiError.notFound('Image not found', 'IMAGE_NOT_FOUND');
  return image;
}

export const productImagesService = {
  /**
   * All files are validated and re-encoded BEFORE anything is uploaded, so one bad file rejects the
   * whole request. If storage fails part-way, already-uploaded files are removed again.
   */
  async upload(productId: string, files: UploadedFile[], req: Request): Promise<ImageView[]> {
    const product = await productsRepository.findBasic(productId);
    if (!product) throw ApiError.notFound('Product not found', 'PRODUCT_NOT_FOUND');
    if (files.length === 0)
      throw new ApiError(400, 'FILE_REQUIRED', 'Attach at least one image in the "images" field');

    const existing = await prisma.productImage.count({ where: { productId } });
    if (existing + files.length > MAX_IMAGES_PER_PRODUCT) {
      throw ApiError.conflict(
        `A product can have at most ${MAX_IMAGES_PER_PRODUCT} images`,
        'TOO_MANY_IMAGES',
      );
    }

    const processed: ProcessedImage[] = [];
    for (const file of files) processed.push(await processImage(file.buffer));

    const stored: (StoredFile & { width: number; height: number })[] = [];
    try {
      for (const image of processed) {
        const result = await storage.upload(image.data, {
          folder: `products/${productId}`,
          contentType: image.contentType,
        });
        stored.push({ ...result, width: image.width, height: image.height });
      }
      const last = await prisma.productImage.aggregate({
        where: { productId },
        _max: { sortOrder: true },
      });
      const start = (last._max.sortOrder ?? -1) + 1;
      await prisma.productImage.createMany({
        data: stored.map((s, i) => ({
          productId,
          storageKey: s.key,
          url: s.url,
          width: s.width,
          height: s.height,
          alt: product.name,
          sortOrder: start + i,
        })),
      });
    } catch (err) {
      await Promise.all(stored.map((s) => removeStoredFile(s.key)));
      throw err;
    }

    await audit(
      {
        action: 'catalog.image.create',
        actorId: actor(req),
        targetType: 'Product',
        targetId: productId,
        metadata: { count: stored.length },
      },
      req,
    );
    return listImages(productId);
  },

  /** `imageIds` must be exactly the product's images, in the new order. */
  async reorder(productId: string, imageIds: string[], req: Request): Promise<ImageView[]> {
    const product = await productsRepository.findBasic(productId);
    if (!product) throw ApiError.notFound('Product not found', 'PRODUCT_NOT_FOUND');
    const current = await prisma.productImage.findMany({
      where: { productId },
      select: { id: true },
    });
    const same =
      current.length === imageIds.length &&
      new Set(imageIds).size === imageIds.length &&
      current.every((c) => imageIds.includes(c.id));
    if (!same) {
      throw ApiError.validation([
        { path: 'body.imageIds', message: 'Send every image of this product exactly once' },
      ]);
    }
    await prisma.$transaction(
      imageIds.map((id, index) =>
        prisma.productImage.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    await audit(
      {
        action: 'catalog.image.reorder',
        actorId: actor(req),
        targetType: 'Product',
        targetId: productId,
      },
      req,
    );
    return listImages(productId);
  },

  async update(
    imageId: string,
    input: { alt?: string | null | undefined; variantId?: string | null | undefined },
    req: Request,
  ): Promise<ImageView> {
    const image = await getImageOrThrow(imageId);
    if (input.variantId) {
      const belongs = await prisma.productVariant.count({
        where: { id: input.variantId, productId: image.productId, deletedAt: null },
      });
      if (!belongs)
        throw ApiError.validation([
          { path: 'body.variantId', message: 'Variant not found on this product' },
        ]);
    }
    const updated = await prisma.productImage.update({
      where: { id: imageId },
      data: defined(input),
    });
    await audit(
      {
        action: 'catalog.image.update',
        actorId: actor(req),
        targetType: 'ProductImage',
        targetId: imageId,
      },
      req,
    );
    return toImageView(updated);
  },

  async remove(imageId: string, req: Request): Promise<void> {
    const image = await getImageOrThrow(imageId);
    await prisma.productImage.delete({ where: { id: imageId } });
    await removeStoredFile(image.storageKey);
    await audit(
      {
        action: 'catalog.image.delete',
        actorId: actor(req),
        targetType: 'ProductImage',
        targetId: imageId,
      },
      req,
    );
  },
};
