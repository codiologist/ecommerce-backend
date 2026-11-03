import { drainJobs } from '../../src/lib/jobs.js';
import { testOutbox } from '../../src/lib/mailer.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';

/** Empties all tables (child tables first) and the test Redis DB. Extend as models are added. */
export async function resetState(): Promise<void> {
  await drainJobs();
  await prisma.$transaction([
    // Phase 2 catalog (children first)
    prisma.inventoryMovement.deleteMany(),
    prisma.productImage.deleteMany(),
    prisma.variantAttributeValue.deleteMany(),
    prisma.productVariant.deleteMany(),
    prisma.product.deleteMany(),
    prisma.attributeValue.deleteMany(),
    prisma.attribute.deleteMany(),
    prisma.brand.deleteMany(),
    prisma.category.updateMany({ data: { parentId: null } }),
    prisma.category.deleteMany(),
    // Phase 1
    prisma.auditLog.deleteMany(),
    prisma.session.deleteMany(),
    prisma.emailVerificationToken.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.twoFactorSecret.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  await redis.flushdb();
  testOutbox.length = 0;
}
