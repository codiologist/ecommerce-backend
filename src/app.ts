import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import hpp from 'hpp';
import { pinoHttp } from 'pino-http';

import { API_PREFIX, JSON_BODY_LIMIT, REQUEST_TIMEOUT_MS } from './config/constants.js';
import { corsOptions } from './config/cors.js';
import { env, isProduction } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { noStore } from './middlewares/noStore.js';
import { notFound } from './middlewares/notFound.js';
import { requestId } from './middlewares/requestId.js';
import { requireJsonContentType } from './middlewares/requireJsonContentType.js';
import { requestTimeout } from './middlewares/timeout.js';
import { apiRouter } from './routes.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Exact hop count (never `true`) so req.ip is the real client IP behind Cloudflare/LB (§4.2).
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  // Express 5 default is "simple"; keep it explicit - no nested objects from query strings.
  app.set('query parser', 'simple');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(
    helmet({
      // JSON API: nothing should ever be rendered or framed.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: isProduction
        ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
        : false,
    }),
  );
  app.use(cors(corsOptions));
  app.use(requestTimeout(REQUEST_TIMEOUT_MS));
  app.use(requireJsonContentType);
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true, type: 'application/json' }));
  app.use(cookieParser());
  app.use(hpp());
  app.use(noStore);

  app.use(API_PREFIX, apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
