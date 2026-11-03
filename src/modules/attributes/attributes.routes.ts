import { Router } from 'express';

import { validate } from '../../middlewares/validate.js';
import { canDelete, idParamsSchema } from '../catalog/common.js';

import { attributesController as c } from './attributes.controller.js';
import {
  createAttributeSchema,
  createAttributeValueSchema,
  updateAttributeSchema,
  updateAttributeValueSchema,
  valueParamsSchema,
} from './attributes.schema.js';

/** Mounted at /api/v1/admin/attributes. */
export const attributesRouter: Router = Router();

attributesRouter.get('/', c.list);
attributesRouter.post('/', validate({ body: createAttributeSchema }), c.create);
attributesRouter.patch(
  '/values/:valueId',
  validate({ params: valueParamsSchema, body: updateAttributeValueSchema }),
  c.updateValue,
);
attributesRouter.delete(
  '/values/:valueId',
  validate({ params: valueParamsSchema }),
  ...canDelete,
  c.removeValue,
);
attributesRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateAttributeSchema }),
  c.update,
);
attributesRouter.delete('/:id', validate({ params: idParamsSchema }), ...canDelete, c.remove);
attributesRouter.post(
  '/:id/values',
  validate({ params: idParamsSchema, body: createAttributeValueSchema }),
  c.createValue,
);
