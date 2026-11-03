import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.js';
import { validate } from '../../middlewares/validate.js';

import { usersController } from './users.controller.js';
import { changePasswordSchema, sessionIdParamsSchema, updateMeSchema } from './users.schema.js';

export const usersRouter: Router = Router();

usersRouter.use(authenticate);

usersRouter.get('/me', usersController.getMe);
usersRouter.patch('/me', validate({ body: updateMeSchema }), usersController.updateMe);
usersRouter.post(
  '/me/change-password',
  validate({ body: changePasswordSchema }),
  usersController.changePassword,
);
usersRouter.get('/me/sessions', usersController.listSessions);
usersRouter.delete(
  '/me/sessions/:id',
  validate({ params: sessionIdParamsSchema }),
  usersController.revokeSession,
);
