import { sendSuccess } from '../../utils/response.js';

import { productImagesService } from './product-images.service.js';
import { productsService } from './products.service.js';
import { variantsService } from './variants.service.js';

import type {
  BulkProductsInput,
  CreateProductInput,
  CreateVariantInput,
  ListProductsQuery,
  UpdateProductInput,
  UpdateVariantInput,
} from './products.schema.js';
import type { UploadedFile } from '../catalog/common.js';
import type { Request, Response } from 'express';

const param = (req: Request, name: 'id' | 'variantId' | 'imageId') =>
  (req.params as Record<string, string>)[name] ?? '';

export const productsController = {
  list: async (req: Request, res: Response) => {
    const { items, meta } = await productsService.list(req.query as unknown as ListProductsQuery);
    sendSuccess(res, items, { meta });
  },
  get: async (req: Request, res: Response) => {
    sendSuccess(res, await productsService.get(param(req, 'id')));
  },
  create: async (req: Request, res: Response) => {
    sendSuccess(res, await productsService.create(req.body as CreateProductInput, req), {
      status: 201,
    });
  },
  update: async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await productsService.update(param(req, 'id'), req.body as UpdateProductInput, req),
    );
  },
  remove: async (req: Request, res: Response) => {
    await productsService.remove(param(req, 'id'), req);
    res.status(204).end();
  },
  bulk: async (req: Request, res: Response) => {
    sendSuccess(res, await productsService.bulk(req.body as BulkProductsInput, req));
  },

  createVariant: async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await variantsService.create(param(req, 'id'), req.body as CreateVariantInput, req),
      { status: 201 },
    );
  },
  updateVariant: async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await variantsService.update(param(req, 'variantId'), req.body as UpdateVariantInput, req),
    );
  },
  removeVariant: async (req: Request, res: Response) => {
    await variantsService.remove(param(req, 'variantId'), req);
    res.status(204).end();
  },

  uploadImages: async (req: Request, res: Response) => {
    const files = (req.files as UploadedFile[] | undefined) ?? [];
    sendSuccess(res, await productImagesService.upload(param(req, 'id'), files, req), {
      status: 201,
    });
  },
  reorderImages: async (req: Request, res: Response) => {
    const { imageIds } = req.body as { imageIds: string[] };
    sendSuccess(res, await productImagesService.reorder(param(req, 'id'), imageIds, req));
  },
  updateImage: async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await productImagesService.update(
        param(req, 'imageId'),
        req.body as { alt?: string | null; variantId?: string | null },
        req,
      ),
    );
  },
  removeImage: async (req: Request, res: Response) => {
    await productImagesService.remove(param(req, 'imageId'), req);
    res.status(204).end();
  },
};
