import { Role } from '@prisma/client';
import { Router } from 'express';

import { authenticate, requireAuthContext } from '../../middlewares/authenticate.js';
import { requireAdminTwoFactor, requireRole } from '../../middlewares/rbac.js';
import { sendSuccess } from '../../utils/response.js';

/**
 * All /api/v1/admin/* routes: authenticated, staff-or-above, 2FA enabled and verified
 * (requirements §3, §6). Admin feature modules (Phase 2+) mount their routers here.
 */
export const adminRouter: Router = Router();

adminRouter.use(
  authenticate,
  requireRole(Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN),
  requireAdminTwoFactor,
);

/** Minimal admin endpoint: lets the admin UI confirm access, and backs the RBAC tests. */
adminRouter.get('/session', (req, res) => {
  const auth = requireAuthContext(req.auth);
  sendSuccess(res, {
    userId: auth.userId,
    role: auth.role,
    twoFactorVerified: auth.twoFactorVerified,
  });
});
