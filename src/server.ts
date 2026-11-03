import { createApp } from './app.js';
import { env } from './config/env.js';
import { drainJobs } from './lib/jobs.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening');
});

// Slightly above typical proxy keep-alive so the LB closes idle sockets first.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 60_000;

let shuttingDown = false;

function shutdown(signal: string, exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  const forceExit = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close((err) => {
    if (err) logger.error({ err }, 'Error closing HTTP server');
    drainJobs()
      .then(() => Promise.allSettled([prisma.$disconnect(), redis.quit()]))
      .catch((closeErr: unknown) => {
        logger.error({ err: closeErr }, 'Error during shutdown');
      })
      .finally(() => process.exit(exitCode));
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException', 1);
});
