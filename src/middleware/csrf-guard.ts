// Rejects state-changing requests with a bad Origin or missing X-Requested-With header
// (NFR-011, architecture.md 4.3). Layered on top of SameSite=Lax cookies.
import type { RequestHandler } from 'express';
import { ForbiddenError } from '../lib/errors.ts';
import { allowedOrigins } from './security.ts';

export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'mission-control';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // Browsers always send Origin on cross-site POSTs, so a foreign origin is rejected outright.
  const origin = req.get('origin');
  if (origin !== undefined && !allowedOrigins.has(origin)) {
    throw new ForbiddenError('CSRF_REJECTED', 'Request origin is not allowed.');
  }

  // An HTML form can't set custom headers, and cross-origin JS that tries triggers a CORS
  // preflight we reject, so this header proves the request came from our own frontend code.
  if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    throw new ForbiddenError(
      'CSRF_REJECTED',
      `Missing or invalid ${CSRF_HEADER} header (expected "${CSRF_HEADER_VALUE}").`,
    );
  }

  next();
};
