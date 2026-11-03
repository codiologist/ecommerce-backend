import { sendSuccess } from '../../utils/response.js';
import { requireUploadedFile } from '../catalog/common.js';

import { brandsService } from './brands.service.js';

import type { CreateBrandInput, ListBrandsQuery, UpdateBrandInput } from './brands.schema.js';
import type { Request, Response } from 'express';

const idOf = (req: Request) => (req.params as { id: string }).id;

export const brandsController = {
  list: async (req: Request, res: Response) => {
    const { items, meta } = await brandsService.list(req.query as unknown as ListBrandsQuery);
    sendSuccess(res, items, { meta });
  },
  get: async (req: Request, res: Response) => {
    sendSuccess(res, await brandsService.get(idOf(req)));
  },
  create: async (req: Request, res: Response) => {
    sendSuccess(res, await brandsService.create(req.body as CreateBrandInput, req), {
      status: 201,
    });
  },
  update: async (req: Request, res: Response) => {
    sendSuccess(res, await brandsService.update(idOf(req), req.body as UpdateBrandInput, req));
  },
  remove: async (req: Request, res: Response) => {
    await brandsService.remove(idOf(req), req);
    res.status(204).end();
  },
  setLogo: async (req: Request, res: Response) => {
    const file = requireUploadedFile(req.file);
    sendSuccess(res, await brandsService.setLogo(idOf(req), file, req));
  },
  removeLogo: async (req: Request, res: Response) => {
    sendSuccess(res, await brandsService.removeLogo(idOf(req), req));
  },
};
