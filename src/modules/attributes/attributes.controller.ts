import { sendSuccess } from '../../utils/response.js';

import { attributesService } from './attributes.service.js';

import type {
  CreateAttributeInput,
  CreateAttributeValueInput,
  UpdateAttributeInput,
  UpdateAttributeValueInput,
} from './attributes.schema.js';
import type { Request, Response } from 'express';

const param = (req: Request, name: 'id' | 'valueId') =>
  (req.params as Record<string, string>)[name] ?? '';

export const attributesController = {
  list: async (_req: Request, res: Response) => {
    sendSuccess(res, await attributesService.list());
  },
  create: async (req: Request, res: Response) => {
    sendSuccess(res, await attributesService.create(req.body as CreateAttributeInput, req), {
      status: 201,
    });
  },
  update: async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await attributesService.update(param(req, 'id'), req.body as UpdateAttributeInput, req),
    );
  },
  remove: async (req: Request, res: Response) => {
    await attributesService.remove(param(req, 'id'), req);
    res.status(204).end();
  },
  createValue: async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await attributesService.createValue(
        param(req, 'id'),
        req.body as CreateAttributeValueInput,
        req,
      ),
      { status: 201 },
    );
  },
  updateValue: async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await attributesService.updateValue(
        param(req, 'valueId'),
        req.body as UpdateAttributeValueInput,
        req,
      ),
    );
  },
  removeValue: async (req: Request, res: Response) => {
    await attributesService.removeValue(param(req, 'valueId'), req);
    res.status(204).end();
  },
};
