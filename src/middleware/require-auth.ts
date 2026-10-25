// Loads the session from the mc_session cookie and attaches req.auth = { userId, sessionId }
// (architecture.md 4.2). Every protected route runs this first.
import type { NextFunction, Request, Response } from 'express';
import { UnauthenticatedError } from '../lib/errors.ts';
import { resolveSession, type AuthContext } from '../modules/auth/auth.service.ts';
import { clearSessionCookie, readSessionCookie } from '../modules/auth/session-cookie.ts';

declare global {
  // Express's own types are declared this way; augmenting them requires the same namespace form.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readSessionCookie(req);
  if (token === undefined) throw new UnauthenticatedError();

  try {
    req.auth = await resolveSession(token);
  } catch (err) {
    // Unknown or expired session: drop the dead cookie so the browser stops sending it.
    if (err instanceof UnauthenticatedError) clearSessionCookie(res);
    throw err;
  }
  next();
}

// For controllers behind requireAuth: returns the auth context with a non-optional type.
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw new UnauthenticatedError();
  return req.auth;
}
