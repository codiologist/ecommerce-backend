import { sendSuccess } from '../../utils/response.js';
import { requireUploadedFile } from '../catalog/common.js';

import { categoriesService } from './categories.service.js';

import type {
  CreateCategoryInput,
  ReorderCategoriesInput,
  UpdateCategoryInput,
} from './categories.schema.js';
import type { Request, Response } from 'express';

const idOf = (req: Request) => (req.params as { id: string }).id;

export const categoriesController = {
  list: async (_req: Request, res: Response) => {
    sendSuccess(res, await categoriesService.list());
  },
  get: async (req: Request, res: Response) => {
    sendSuccess(res, await categoriesService.get(idOf(req)));
  },
  create: async (req: Request, res: Response) => {
    sendSuccess(res, await categoriesService.create(req.body as CreateCategoryInput, req), {
      status: 201,
    });
  },
  update: async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await categoriesService.update(idOf(req), req.body as UpdateCategoryInput, req),
    );
  },
  remove: async (req: Request, res: Response) => {
    await categoriesService.remove(idOf(req), req);
    res.status(204).end();
  },
  reorder: async (req: Request, res: Response) => {
    await categoriesService.reorder(req.body as ReorderCategoriesInput, req);
    res.status(204).end();
  },
  setImage: async (req: Request, res: Response) => {
    const file = requireUploadedFile(req.file);
    sendSuccess(res, await categoriesService.setImage(idOf(req), file, req));
  },
  removeImage: async (req: Request, res: Response) => {
    sendSuccess(res, await categoriesService.removeImage(idOf(req), req));
  },
};
