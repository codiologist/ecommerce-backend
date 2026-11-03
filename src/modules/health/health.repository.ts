import { prisma } from '../../lib/prisma.js';

export const healthRepository = {
  /** Tagged template $queryRaw is parameterised; $queryRawUnsafe is forbidden (§4.2). */
  async ping(): Promise<void> {
    await prisma.$queryRaw`SELECT 1`;
  },
};
