// Vercel entrypoint: the same app as server.ts, run as a serverless function instead of a
// long-lived process. A warm instance serves many requests, so we connect once per instance and
// every request awaits the same promise. No listen() and no SIGTERM handling: Vercel manages
// the instances. Loaded through api/index.js after `pnpm build`.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.ts';
import { connectToDatabase } from './db/connect.ts';
import { logger } from './lib/logger.ts';
import { resumePendingDeletions } from './modules/auth/auth.service.ts';

const app = createApp();
let ready: Promise<void> | undefined;

function init(): Promise<void> {
  ready ??= (async () => {
    await connectToDatabase();
    // Finish any account deletion interrupted by a previous crash (BR-022). Safe to repeat.
    await resumePendingDeletions();
  })().catch((err: unknown) => {
    // Forget the failure so the next request retries instead of failing forever.
    ready = undefined;
    throw err;
  });
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await init();
  } catch (err) {
    logger.error({ err }, 'Startup failed: database unavailable');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The service is temporarily unavailable. Please try again.',
        },
      }),
    );
    return;
  }
  app(req, res);
}
