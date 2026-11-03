import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.js';
import { rateLimiters } from '../../middlewares/rateLimit.js';
import { requireReauth } from '../../middlewares/rbac.js';
import { validate } from '../../middlewares/validate.js';

import { authController } from './auth.controller.js';
import {
  emailOnlySchema,
  enableTwoFactorSchema,
  loginSchema,
  loginTwoFactorSchema,
  reauthSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
} from './auth.schema.js';

export const authRouter: Router = Router();

authRouter.use(rateLimiters.auth);

authRouter.get('/csrf', authController.csrf);

authRouter.post(
  '/register',
  rateLimiters.register,
  validate({ body: registerSchema }),
  authController.register,
);
authRouter.post('/verify-email', validate({ body: tokenSchema }), authController.verifyEmail);
authRouter.post(
  '/resend-verification',
  rateLimiters.emailSend,
  validate({ body: emailOnlySchema }),
  authController.resendVerification,
);

authRouter.post(
  '/login',
  rateLimiters.login,
  validate({ body: loginSchema }),
  authController.login,
);
authRouter.post(
  '/login/2fa',
  rateLimiters.login,
  validate({ body: loginTwoFactorSchema }),
  authController.loginTwoFactor,
);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.post('/logout-all', authenticate, authController.logoutAll);

authRouter.post(
  '/forgot-password',
  rateLimiters.emailSend,
  validate({ body: emailOnlySchema }),
  authController.forgotPassword,
);
authRouter.post(
  '/reset-password',
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);

authRouter.post('/reauth', authenticate, validate({ body: reauthSchema }), authController.reauth);

authRouter.post('/2fa/setup', authenticate, authController.setupTwoFactor);
authRouter.post(
  '/2fa/enable',
  authenticate,
  validate({ body: enableTwoFactorSchema }),
  authController.enableTwoFactor,
);
authRouter.post('/2fa/disable', authenticate, requireReauth, authController.disableTwoFactor);
