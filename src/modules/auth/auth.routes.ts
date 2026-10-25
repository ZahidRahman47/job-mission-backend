// Route tables for the auth module. No logic: path -> middleware chain -> controller.
// `authRouter` is mounted at /auth; `accountRouter` at /users/me (sessions and account deletion
// need the password/session machinery that lives in this module).
import { Router } from 'express';
import {
  forgotPasswordLimiters,
  loginLimiters,
  passwordCheckLimiter,
  registerLimiter,
  resendVerificationLimiter,
  resetPasswordLimiter,
  userRateLimit,
  verifyEmailLimiter,
} from '../../middleware/rate-limit.ts';
import { requireAuth } from '../../middleware/require-auth.ts';
import * as auth from './auth.controller.ts';

export const authRouter = Router();

authRouter.post('/register', registerLimiter, auth.register);
authRouter.post('/login', ...loginLimiters, auth.login);
authRouter.post('/logout', requireAuth, auth.logout);
authRouter.post('/logout-all', requireAuth, auth.logoutAll);
authRouter.post('/verify-email', verifyEmailLimiter, auth.verifyEmail);
authRouter.post(
  '/verify-email/resend',
  requireAuth,
  resendVerificationLimiter,
  auth.resendVerification,
);
authRouter.post('/password/forgot', ...forgotPasswordLimiters, auth.forgotPassword);
authRouter.post('/password/reset', resetPasswordLimiter, auth.resetPassword);
authRouter.post('/password/change', requireAuth, passwordCheckLimiter, auth.changePassword);

export const accountRouter = Router();

accountRouter.get('/sessions', requireAuth, userRateLimit, auth.listSessions);
accountRouter.delete('/sessions/:sessionId', requireAuth, userRateLimit, auth.revokeSession);
accountRouter.delete('/', requireAuth, passwordCheckLimiter, auth.deleteAccount);
