import { z } from 'zod';

import { nameSchema, phoneSchema } from '../auth/auth.schema.js';

export { changePasswordSchema } from '../auth/auth.schema.js';

/** Only these fields can be changed by the user (strict: role/email/status are rejected). */
export const updateMeSchema = z
  .strictObject({
    name: nameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const sessionIdParamsSchema = z.object({ id: z.uuid() });

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type ChangePasswordInput = { currentPassword: string; newPassword: string };
