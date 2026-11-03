import {
  clearAuthCookies,
  COOKIE_NAMES,
  readCookie,
  setAccessCookie,
  setAuthCookies,
} from '../../config/cookies.js';
import { requireAuthContext } from '../../middlewares/authenticate.js';
import { issueCsrfToken } from '../../middlewares/csrf.js';
import { sendSuccess } from '../../utils/response.js';

import { authService, type LoginResult } from './auth.service.js';

import type {
  LoginInput,
  LoginTwoFactorInput,
  ReauthInput,
  RegisterInput,
  ResetPasswordInput,
} from './auth.schema.js';
import type { Request, Response } from 'express';

const GENERIC_EMAIL_SENT = 'If an account exists for this email, we have sent instructions to it.';

function respondToLogin(res: Response, result: LoginResult): void {
  if (result.kind === 'two_factor_required') {
    sendSuccess(res, { twoFactorRequired: true, challengeId: result.challengeId });
    return;
  }
  setAuthCookies(res, result.tokens);
  issueCsrfToken(res); // rotate on privilege change
  sendSuccess(res, { twoFactorRequired: false, user: result.user });
}

export const authController = {
  csrf: (_req: Request, res: Response) => {
    sendSuccess(res, { csrfToken: issueCsrfToken(res) });
  },

  register: async (req: Request, res: Response) => {
    await authService.register(req.body as RegisterInput, req);
    sendSuccess(
      res,
      { message: 'Account created. Check your email to verify your address.' },
      { status: 201 },
    );
  },

  verifyEmail: async (req: Request, res: Response) => {
    await authService.verifyEmail((req.body as { token: string }).token, req);
    sendSuccess(res, { message: 'Email verified.' });
  },

  resendVerification: (req: Request, res: Response) => {
    authService.resendVerification((req.body as { email: string }).email);
    sendSuccess(res, { message: GENERIC_EMAIL_SENT }, { status: 202 });
  },

  login: async (req: Request, res: Response) => {
    respondToLogin(res, await authService.login(req.body as LoginInput, req));
  },

  loginTwoFactor: async (req: Request, res: Response) => {
    respondToLogin(
      res,
      await authService.completeTwoFactorLogin(req.body as LoginTwoFactorInput, req),
    );
  },

  refresh: async (req: Request, res: Response) => {
    try {
      const outcome = await authService.refresh(readCookie(req, COOKIE_NAMES.refreshToken), req);
      if (outcome.kind === 'rotated') setAuthCookies(res, outcome.tokens);
      else setAccessCookie(res, outcome.accessToken);
      res.status(204).end();
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  },

  logout: async (req: Request, res: Response) => {
    await authService.logout(readCookie(req, COOKIE_NAMES.refreshToken), req.auth, req);
    clearAuthCookies(res);
    issueCsrfToken(res);
    res.status(204).end();
  },

  logoutAll: async (req: Request, res: Response) => {
    await authService.logoutAll(requireAuthContext(req.auth), req);
    clearAuthCookies(res);
    issueCsrfToken(res);
    res.status(204).end();
  },

  forgotPassword: (req: Request, res: Response) => {
    authService.forgotPassword((req.body as { email: string }).email, req);
    sendSuccess(res, { message: GENERIC_EMAIL_SENT }, { status: 202 });
  },

  resetPassword: async (req: Request, res: Response) => {
    await authService.resetPassword(req.body as ResetPasswordInput, req);
    clearAuthCookies(res);
    sendSuccess(res, { message: 'Password updated. Please log in with your new password.' });
  },

  reauth: async (req: Request, res: Response) => {
    await authService.reauth(requireAuthContext(req.auth), req.body as ReauthInput, req);
    res.status(204).end();
  },

  setupTwoFactor: async (req: Request, res: Response) => {
    sendSuccess(res, await authService.setupTwoFactor(requireAuthContext(req.auth)));
  },

  enableTwoFactor: async (req: Request, res: Response) => {
    const { code } = req.body as { code: string };
    sendSuccess(res, await authService.enableTwoFactor(requireAuthContext(req.auth), code, req));
  },

  disableTwoFactor: async (req: Request, res: Response) => {
    await authService.disableTwoFactor(requireAuthContext(req.auth), req);
    res.status(204).end();
  },
};
