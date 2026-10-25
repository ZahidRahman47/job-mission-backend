// Builds and returns the Express app (middleware + routes) without listening, so tests can use it
// directly. Middleware order matters; see architecture.md 3.1.
import cookieParser from 'cookie-parser';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.ts';
import { csrfGuard } from './middleware/csrf-guard.ts';
import { errorHandler } from './middleware/error-handler.ts';
import { httpLogger } from './middleware/http-logger.ts';
import { notFound } from './middleware/not-found.ts';
import { inboundRouter } from './modules/capture/capture.routes.ts';
import { requestId } from './middleware/request-id.ts';
import { corsPolicy, securityHeaders } from './middleware/security.ts';
import { openApiDocument } from './openapi.ts';
import { apiRouter } from './routes.ts';

export function createApp(): express.Express {
  const app = express();

  // Don't advertise the framework in every response header.
  app.disable('x-powered-by');
  // Number of proxies to trust for the client IP (rate limits). Never `true`: clients could spoof it.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  // 1-2. Every later step, including errors, can log with the request ID.
  app.use(requestId);
  app.use(httpLogger);

  // API docs, development only. Mounted before helmet because Swagger UI needs inline scripts
  // that the strict Content-Security-Policy would block.
  if (env.NODE_ENV !== 'production') {
    app.get('/api/v1/openapi.json', (_req, res) => {
      res.json(openApiDocument);
    });
    app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  }

  // 3-4. Security headers on every response; CORS answers preflights before any parsing.
  app.use(securityHeaders);
  app.use(corsPolicy);

  // Gmail script ingest: bearer-token auth (no cookie, so no CSRF) and its own 2 MB body limit.
  app.use('/api/v1/inbound', inboundRouter);

  // 5-6. Parse JSON bodies (over 100 KB -> 413 before our code runs) and cookies.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // 7. Reject cross-site writes before spending a database lookup on the session.
  app.use(csrfGuard);

  // 8+. Feature routes, then 404 for anything unmatched, then the single error handler (last).
  app.use('/api/v1', apiRouter);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
