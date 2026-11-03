import { Router } from 'express';

import { uploadSingleImage } from '../../middlewares/upload.js';
import { validate } from '../../middlewares/validate.js';
import { canDelete, idParamsSchema } from '../catalog/common.js';

import { brandsController as c } from './brands.controller.js';
import { createBrandSchema, listBrandsQuerySchema, updateBrandSchema } from './brands.schema.js';

/** Mounted at /api/v1/admin/brands. */
export const brandsRouter: Router = Router();

brandsRouter.get('/', validate({ query: listBrandsQuerySchema }), c.list);
brandsRouter.post('/', validate({ body: createBrandSchema }), c.create);
brandsRouter.get('/:id', validate({ params: idParamsSchema }), c.get);
brandsRouter.patch('/:id', validate({ params: idParamsSchema, body: updateBrandSchema }), c.update);
brandsRouter.delete('/:id', validate({ params: idParamsSchema }), ...canDelete, c.remove);
brandsRouter.post('/:id/logo', validate({ params: idParamsSchema }), uploadSingleImage, c.setLogo);
brandsRouter.delete('/:id/logo', validate({ params: idParamsSchema }), c.removeLogo);
