import { Role } from '@prisma/client';
import { Router } from 'express';

import { authenticate, requireAuthContext } from '../../middlewares/authenticate.js';
import { requireAdminTwoFactor, requireRole } from '../../middlewares/rbac.js';
import { sendSuccess } from '../../utils/response.js';
import { attributesRouter } from '../attributes/attributes.routes.js';
import { brandsRouter } from '../brands/brands.routes.js';
import { categoriesRouter } from '../categories/categories.routes.js';
import { inventoryRouter } from '../inventory/inventory.routes.js';
import { productPartsRouter, productsRouter } from '../products/products.routes.js';

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

// Phase 2 - Catalog (Admin)
adminRouter.use('/categories', categoriesRouter);
adminRouter.use('/brands', brandsRouter);
adminRouter.use('/attributes', attributesRouter);
adminRouter.use('/products', productsRouter);
adminRouter.use(productPartsRouter);
adminRouter.use(inventoryRouter);
