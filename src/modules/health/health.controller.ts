import { sendSuccess } from '../../utils/response.js';

import { healthService } from './health.service.js';

import type { RequestHandler } from 'express';

export const healthController = {
  getHealth: (async (_req, res) => {
    const health = await healthService.getStatus();
    sendSuccess(res, health, { status: health.status === 'ok' ? 200 : 503 });
  }) satisfies RequestHandler,
};
