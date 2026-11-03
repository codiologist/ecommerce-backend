import { randomUUID } from 'node:crypto';

import { REQUEST_ID_HEADER } from '../config/constants.js';

import type { RequestHandler } from 'express';

// Accept a client/edge-supplied id only if it is short and safe to echo into logs and headers.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};
