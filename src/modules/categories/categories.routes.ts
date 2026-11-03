import { Router } from 'express';

import { uploadSingleImage } from '../../middlewares/upload.js';
import { validate } from '../../middlewares/validate.js';
import { canDelete, idParamsSchema } from '../catalog/common.js';

import { categoriesController as c } from './categories.controller.js';
import {
  createCategorySchema,
  reorderCategoriesSchema,
  updateCategorySchema,
} from './categories.schema.js';

/** Mounted at /api/v1/admin/categories (auth + staff role + 2FA applied by the admin router). */
export const categoriesRouter: Router = Router();

categoriesRouter.get('/', c.list);
categoriesRouter.post('/', validate({ body: createCategorySchema }), c.create);
categoriesRouter.patch('/reorder', validate({ body: reorderCategoriesSchema }), c.reorder);
categoriesRouter.get('/:id', validate({ params: idParamsSchema }), c.get);
categoriesRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateCategorySchema }),
  c.update,
);
categoriesRouter.delete('/:id', validate({ params: idParamsSchema }), ...canDelete, c.remove);
categoriesRouter.post(
  '/:id/image',
  validate({ params: idParamsSchema }),
  uploadSingleImage,
  c.setImage,
);
categoriesRouter.delete('/:id/image', validate({ params: idParamsSchema }), c.removeImage);
