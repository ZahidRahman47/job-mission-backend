// pino-http: one structured log line per request with status, duration, route and request ID (NFR-022).
// Also attaches `req.log`, a child logger that stamps the request ID on every line.
import { pinoHttp } from 'pino-http';
import { logger } from '../lib/logger.ts';

export const httpLogger = pinoHttp({
  logger,
  // Reuse the ID set by the requestId middleware instead of generating a second one.
  genReqId: (req) => req.id,
  // Uptime monitors hit health checks constantly; logging each one would bury real traffic.
  autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Log only what's useful; never headers (cookies) or bodies (passwords).
  serializers: {
    req: (req: { id: unknown; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
});
