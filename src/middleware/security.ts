// helmet (security headers) and CORS allow-list with credentials (NFR-012, NFR-013).
import cors from 'cors';
import helmet from 'helmet';
import { env } from '../config/env.ts';

// Who may call us from a browser. In development the API's own origin is added so Swagger UI's
// "Try it out" works.
export const allowedOrigins = new Set<string>([
  ...env.WEB_ORIGINS,
  ...(env.NODE_ENV === 'production' ? [] : [`http://localhost:${String(env.PORT)}`]),
]);

export const securityHeaders = helmet();

export const corsPolicy = cors({
  // Never `*`: with cookies, a wildcard would let any site make logged-in requests.
  origin: (requestOrigin, callback) => {
    callback(null, requestOrigin === undefined || allowedOrigins.has(requestOrigin));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'X-Requested-With', 'X-Request-Id'],
  // Content-Disposition: lets the web app name downloaded export files.
  exposedHeaders: ['X-Request-Id', 'Retry-After', 'Content-Disposition'],
  maxAge: 600,
});
