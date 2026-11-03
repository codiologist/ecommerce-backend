import { Router } from 'express';

import { uploadProductImages } from '../../middlewares/upload.js';
import { validate } from '../../middlewares/validate.js';
import { canDelete, idParamsSchema } from '../catalog/common.js';

import { productsController as c } from './products.controller.js';
import {
  bulkProductsSchema,
  createProductSchema,
  createVariantSchema,
  imageParamsSchema,
  listProductsQuerySchema,
  reorderImagesSchema,
  updateImageSchema,
  updateProductSchema,
  updateVariantSchema,
  variantParamsSchema,
} from './products.schema.js';

/** Mounted at /api/v1/admin/products. */
export const productsRouter: Router = Router();

productsRouter.get('/', validate({ query: listProductsQuerySchema }), c.list);
productsRouter.post('/', validate({ body: createProductSchema }), c.create);
productsRouter.post('/bulk', validate({ body: bulkProductsSchema }), c.bulk); // delete action gated inside
productsRouter.get('/:id', validate({ params: idParamsSchema }), c.get);
productsRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateProductSchema }),
  c.update,
);
productsRouter.delete('/:id', validate({ params: idParamsSchema }), ...canDelete, c.remove);

productsRouter.post(
  '/:id/variants',
  validate({ params: idParamsSchema, body: createVariantSchema }),
  c.createVariant,
);
productsRouter.post(
  '/:id/images',
  validate({ params: idParamsSchema }),
  uploadProductImages,
  c.uploadImages,
);
productsRouter.patch(
  '/:id/images/order',
  validate({ params: idParamsSchema, body: reorderImagesSchema }),
  c.reorderImages,
);

/** Mounted at /api/v1/admin (variant and image routes addressed by their own id). */
export const productPartsRouter: Router = Router();

productPartsRouter.patch(
  '/variants/:variantId',
  validate({ params: variantParamsSchema, body: updateVariantSchema }),
  c.updateVariant,
);
productPartsRouter.delete(
  '/variants/:variantId',
  validate({ params: variantParamsSchema }),
  ...canDelete,
  c.removeVariant,
);
productPartsRouter.patch(
  '/images/:imageId',
  validate({ params: imageParamsSchema, body: updateImageSchema }),
  c.updateImage,
);
productPartsRouter.delete(
  '/images/:imageId',
  validate({ params: imageParamsSchema }),
  c.removeImage,
);
