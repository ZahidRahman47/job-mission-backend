// The session cookie: name, lifetimes and flags in one place (architecture.md 4.1-4.2).
import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env.ts';

export const SESSION_COOKIE = 'mc_session';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TTL_MS = 30 * DAY_MS; // max lifetime, even if used every day
export const SESSION_IDLE_TTL_MS = 7 * DAY_MS; // expires after a week without activity
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000; // slide idle expiry at most every 5 min

const cookieOptions: CookieOptions = {
  httpOnly: true, // JavaScript can't read it, so XSS can't steal it
  secure: env.NODE_ENV === 'production', // HTTPS only in production
  sameSite: 'lax', // not sent on cross-site POSTs (first CSRF layer)
  path: '/',
  ...(env.COOKIE_DOMAIN !== undefined && { domain: env.COOKIE_DOMAIN }),
};

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_ABSOLUTE_TTL_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}

export function readSessionCookie(req: Request): string | undefined {
  const value: unknown = req.cookies[SESSION_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
