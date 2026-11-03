import { Router } from 'express';

import { validate } from '../../middlewares/validate.js';
import { sendSuccess } from '../../utils/response.js';
import { variantParamsSchema } from '../products/products.schema.js';

import {
  lowStockQuerySchema,
  movementsQuerySchema,
  stockAdjustmentSchema,
  type StockAdjustmentInput,
} from './inventory.schema.js';
import { inventoryService } from './inventory.service.js';

import type { OffsetPagination } from '../../utils/pagination.js';
import type { Request, Response } from 'express';

const variantId = (req: Request) => (req.params as { variantId: string }).variantId;

const controller = {
  adjust: async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await inventoryService.adjust(variantId(req), req.body as StockAdjustmentInput, req),
      { status: 201 },
    );
  },
  movements: async (req: Request, res: Response) => {
    const { items, meta } = await inventoryService.movements(
      variantId(req),
      req.query as unknown as OffsetPagination,
    );
    sendSuccess(res, items, { meta });
  },
  lowStock: async (req: Request, res: Response) => {
    const { items, meta } = await inventoryService.lowStock(
      req.query as unknown as OffsetPagination,
    );
    sendSuccess(res, items, { meta });
  },
};

/** Mounted at /api/v1/admin (paths are /variants/:variantId/... and /inventory/...). */
export const inventoryRouter: Router = Router();

inventoryRouter.post(
  '/variants/:variantId/stock-adjustments',
  validate({ params: variantParamsSchema, body: stockAdjustmentSchema }),
  controller.adjust,
);
inventoryRouter.get(
  '/variants/:variantId/movements',
  validate({ params: variantParamsSchema, query: movementsQuerySchema }),
  controller.movements,
);
inventoryRouter.get(
  '/inventory/low-stock',
  validate({ query: lowStockQuerySchema }),
  controller.lowStock,
);
