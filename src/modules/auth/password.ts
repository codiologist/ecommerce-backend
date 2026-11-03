import { dictionary } from '@zxcvbn-ts/language-common';
import argon2 from 'argon2';

export const PASSWORD_MIN_LENGTH = 8;
/** Upper bound protects the hasher from very long inputs (DoS). */
export const PASSWORD_MAX_LENGTH = 128;

// OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1) are the minimum; we use more memory.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

let commonPasswords: Set<string> | undefined;

/** ~49k most common passwords (zxcvbn-ts common dictionary), loaded once. */
function getCommonPasswords(): Set<string> {
  commonPasswords ??= new Set(dictionary['passwords-common'].map((p) => p.toLowerCase()));
  return commonPasswords;
}

/** Returns a user-facing problem, or null if the password is acceptable (requirements §3). */
export function checkPasswordPolicy(
  password: string,
  context: { email?: string } = {},
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  const lower = password.toLowerCase();
  if (getCommonPasswords().has(lower)) {
    return 'This password is too common. Please choose a less predictable one';
  }
  if (/^(.)\1+$/.test(password)) return 'Password cannot be a single repeated character';
  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && lower.includes(localPart)) {
    return 'Password must not contain your email address';
  }
  return null;
}

export const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, ARGON2_OPTIONS);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Runs a full Argon2 verification against a throwaway hash so that "unknown email" takes as long as
 * "wrong password" (no user enumeration via timing, requirements §3).
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummyHash, password);
  return false;
}
