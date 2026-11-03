/**
 * Seed (requirements §8): creates the SUPER_ADMIN from SEED_SUPER_ADMIN_EMAIL / _PASSWORD.
 * Idempotent: an existing account is never modified (its password is not reset).
 * The super admin must set up TOTP 2FA on first login before any admin route works.
 * Run: npm run db:seed
 */
import { PrismaClient, Role } from '@prisma/client';

import { checkPasswordPolicy, hashPassword } from '../src/modules/auth/password.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD must be set');
  }
  const problem = checkPasswordPolicy(password, { email });
  if (problem) throw new Error(`SEED_SUPER_ADMIN_PASSWORD rejected: ${problem}`);
  if (password.length < 14)
    throw new Error('SEED_SUPER_ADMIN_PASSWORD must be at least 14 characters');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    process.stdout.write(`Super admin ${email} already exists - left unchanged.\n`);
    return;
  }
  await prisma.user.create({
    data: {
      email,
      name: 'Super Admin',
      passwordHash: await hashPassword(password),
      role: Role.SUPER_ADMIN,
      emailVerifiedAt: new Date(),
    },
  });
  process.stdout.write(`Super admin ${email} created. Set up 2FA on first login.\n`);
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
