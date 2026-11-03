import { Router } from 'express';

import { healthRouter } from './modules/health/health.routes.js';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
