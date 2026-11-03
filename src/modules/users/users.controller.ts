import { clearAuthCookies } from '../../config/cookies.js';
import { requireAuthContext } from '../../middlewares/authenticate.js';
import { sendSuccess } from '../../utils/response.js';

import { usersService } from './users.service.js';

import type { ChangePasswordInput, UpdateMeInput } from './users.schema.js';
import type { Request, Response } from 'express';

export const usersController = {
  getMe: async (req: Request, res: Response) => {
    sendSuccess(res, await usersService.getMe(requireAuthContext(req.auth)));
  },

  updateMe: async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await usersService.updateMe(requireAuthContext(req.auth), req.body as UpdateMeInput),
    );
  },

  changePassword: async (req: Request, res: Response) => {
    await usersService.changePassword(
      requireAuthContext(req.auth),
      req.body as ChangePasswordInput,
      req,
    );
    res.status(204).end();
  },

  listSessions: async (req: Request, res: Response) => {
    sendSuccess(res, await usersService.listSessions(requireAuthContext(req.auth)));
  },

  revokeSession: async (req: Request, res: Response) => {
    const auth = requireAuthContext(req.auth);
    const { id } = req.params as { id: string };
    await usersService.revokeSession(auth, id, req);
    if (id === auth.sessionFamilyId) clearAuthCookies(res);
    res.status(204).end();
  },
};
