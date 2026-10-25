// HTTP <-> auth service: validates input, calls the service, sets/clears the session cookie and
// picks the status code. No business rules here.
import type { Request, Response } from 'express';
import { parseInput } from '../../lib/validation.ts';
import { getAuth } from '../../middleware/require-auth.ts';
import {
  changePasswordBody,
  deleteAccountBody,
  forgotPasswordBody,
  loginBody,
  registerBody,
  resetPasswordBody,
  sessionIdParams,
  verifyEmailBody,
} from './auth.schemas.ts';
import * as authService from './auth.service.ts';
import { clearSessionCookie, setSessionCookie } from './session-cookie.ts';

function clientInfo(req: Request): authService.ClientInfo {
  return { userAgent: req.get('user-agent'), ip: req.ip };
}

function sendMessage(res: Response, status: number, message: string): void {
  res.status(status).json({ data: { message } });
}

export async function register(req: Request, res: Response): Promise<void> {
  const body = parseInput(registerBody, req.body, 'body');
  await authService.register(body);
  sendMessage(res, 202, 'Check your email to verify your account, then log in.');
}

export async function login(req: Request, res: Response): Promise<void> {
  const body = parseInput(loginBody, req.body, 'body');
  const { token, user } = await authService.login(body, clientInfo(req));
  setSessionCookie(res, token);
  res.status(200).json({ data: user });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(getAuth(req));
  clearSessionCookie(res);
  res.status(204).end();
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  await authService.logoutAll(getAuth(req));
  clearSessionCookie(res);
  res.status(204).end();
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const { token } = parseInput(verifyEmailBody, req.body, 'body');
  await authService.verifyEmail(token);
  sendMessage(res, 200, 'Your email address is verified.');
}

export async function resendVerification(req: Request, res: Response): Promise<void> {
  await authService.resendVerification(getAuth(req));
  sendMessage(res, 202, 'If your email is not verified yet, a new link is on its way.');
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = parseInput(forgotPasswordBody, req.body, 'body');
  await authService.forgotPassword(email);
  sendMessage(res, 202, 'If an account exists for this email, a reset link is on its way.');
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = parseInput(resetPasswordBody, req.body, 'body');
  await authService.resetPassword(token, password);
  res.status(204).end();
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = parseInput(changePasswordBody, req.body, 'body');
  await authService.changePassword(getAuth(req), currentPassword, newPassword);
  res.status(204).end();
}

export async function listSessions(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await authService.listSessions(getAuth(req)) });
}

export async function revokeSession(req: Request, res: Response): Promise<void> {
  const { sessionId } = parseInput(sessionIdParams, req.params, 'params');
  const { wasCurrent } = await authService.revokeSession(getAuth(req), sessionId);
  if (wasCurrent) clearSessionCookie(res);
  res.status(204).end();
}

export async function deleteAccount(req: Request, res: Response): Promise<void> {
  const { password } = parseInput(deleteAccountBody, req.body, 'body');
  await authService.deleteAccount(getAuth(req), password);
  clearSessionCookie(res);
  res.status(204).end();
}
