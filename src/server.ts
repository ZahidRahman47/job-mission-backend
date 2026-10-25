// Process entrypoint: connect to MongoDB, start listening, handle SIGTERM/SIGINT (graceful shutdown, NFR-024).
import type { Server } from 'node:http';
import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { connectToDatabase, disconnectFromDatabase } from './db/connect.ts';
import { logger } from './lib/logger.ts';
import { resumePendingDeletions } from './modules/auth/auth.service.ts';
import { markShuttingDown } from './modules/health/health.controller.ts';

// In-flight requests get this long to finish before we force-exit.
const SHUTDOWN_TIMEOUT_MS = 10_000;

function listen(app: ReturnType<typeof createApp>): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(env.PORT, (error?: Error) => {
      if (error) reject(error);
      else resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function main(): Promise<void> {
  // Database first: if it's unreachable, fail startup instead of serving errors.
  await connectToDatabase();
  // Finish any account deletion interrupted by a previous crash or deploy (BR-022).
  await resumePendingDeletions();
  const server = await listen(createApp());
  logger.info(`API listening on http://localhost:${String(env.PORT)} (${env.NODE_ENV})`);

  let shuttingDown = false;
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down: no new connections, finishing in-flight requests');

    markShuttingDown();
    const forceExit = setTimeout(() => {
      logger.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    // Don't let this timer by itself keep the process alive.
    forceExit.unref();

    try {
      await closeServer(server);
      await disconnectFromDatabase();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  }

  // SIGTERM: what hosting platforms send on deploy/scale-down. SIGINT: Ctrl+C in the terminal.
  process.on('SIGTERM', (signal) => void shutdown(signal));
  process.on('SIGINT', (signal) => void shutdown(signal));
}

// Scenario 7: a bug threw outside any request. The process state is now unknown, so log it and
// exit; the host restarts a clean process. Never "catch and carry on" here.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception, exiting');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection, exiting');
  process.exit(1);
});

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Startup failed');
  process.exit(1);
});
