import { z } from 'zod';

import { checkPasswordPolicy, PASSWORD_MAX_LENGTH } from './password.js';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254));

/** Login accepts any non-empty password (policy is only enforced when setting one). */
const loginPasswordSchema = z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH);

const newPasswordSchema = z.string().superRefine((value, ctx) => {
  const problem = checkPasswordPolicy(value);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

const opaqueToken = z.string().trim().min(20).max(200);
const turnstileToken = z.string().trim().min(1).max(2048).optional();
const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code');
const backupCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/, 'Enter a valid backup code');

export const nameSchema = z.string().trim().min(1, 'Name is required').max(100);
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number');

const noEmailInPassword = (data: { email: string; password: string }, ctx: z.RefinementCtx) => {
  const problem = checkPasswordPolicy(data.password, { email: data.email });
  if (problem) ctx.addIssue({ code: 'custom', path: ['password'], message: problem });
};

export const registerSchema = z
  .object({
    email: emailSchema,
    password: z.string().max(PASSWORD_MAX_LENGTH),
    name: nameSchema,
    turnstileToken,
  })
  .superRefine(noEmailInPassword);

export const loginSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema,
  turnstileToken,
});

export const loginTwoFactorSchema = z
  .object({
    challengeId: opaqueToken,
    code: totpCode.optional(),
    backupCode: backupCode.optional(),
  })
  .refine((d) => Boolean(d.code) !== Boolean(d.backupCode), {
    message: 'Provide either a code or a backup code',
    path: ['code'],
  });

export const tokenSchema = z.object({ token: opaqueToken });
export const emailOnlySchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({ token: opaqueToken, password: newPasswordSchema });

export const reauthSchema = z.object({ password: loginPasswordSchema, code: totpCode.optional() });

export const enableTwoFactorSchema = z.object({ code: totpCode });

export const changePasswordSchema = z
  .object({ currentPassword: loginPasswordSchema, newPassword: newPasswordSchema })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type LoginTwoFactorInput = z.infer<typeof loginTwoFactorSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ReauthInput = z.infer<typeof reauthSchema>;
