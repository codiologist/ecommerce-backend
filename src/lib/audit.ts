import { Prisma } from '@prisma/client';

import { logger } from './logger.js';
import { prisma } from './prisma.js';

import type { Request } from 'express';

export type AuditAction =
  | 'auth.register'
  | 'auth.login_success'
  | 'auth.login_failed'
  | 'auth.account_locked'
  | 'auth.login_blocked_user'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.refresh_token_reuse'
  | 'auth.email_verified'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.password_changed'
  | 'auth.reauth'
  | 'auth.2fa_enabled'
  | 'auth.2fa_disabled'
  | 'auth.2fa_failed'
  | 'auth.backup_code_used'
  | 'auth.session_revoked';

export type AuditEntry = {
  action: AuditAction;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

/** Writes an audit record. Never throws: auditing must not break the request (failures are logged). */
export async function audit(entry: AuditEntry, req?: Request): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: (entry.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        ip: req?.ip ?? null,
        userAgent: req?.get('user-agent')?.slice(0, 512) ?? null,
        requestId: typeof req?.id === 'string' ? req.id : null,
      },
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
  }
}
