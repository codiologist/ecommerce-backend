import { PrismaClient } from '@prisma/client';

import { isProduction } from '../config/env.js';

/**
 * Single PrismaClient instance for the whole process (requirements §1.1).
 * In development the instance is cached on globalThis so `tsx watch` reloads don't leak connections.
 * Never use $queryRawUnsafe / $executeRawUnsafe (requirements §4.2).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['error'] : ['warn', 'error'],
  });

if (!isProduction) globalForPrisma.prisma = prisma;
