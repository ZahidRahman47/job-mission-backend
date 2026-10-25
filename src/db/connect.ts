// Mongoose connection lifecycle: connect once at startup (with retries), watch the connection while
// running, disconnect on shutdown. One pool is shared by every request; opening a connection per
// request would cost ~1 s each.
import { setTimeout as sleep } from 'node:timers/promises';
import mongoose from 'mongoose';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';

// Reject query filters on fields that aren't in the schema instead of silently ignoring them.
mongoose.set('strictQuery', true);
// Never create collections/indexes as a side effect of loading a model: that would race the
// connection. syncIndexes() does it explicitly after connecting, in every environment.
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
// While disconnected, fail queries (after server selection times out) instead of queueing them in
// memory with no limit.
mongoose.set('bufferCommands', false);
// Queries inside withTransaction() join the transaction automatically (see db/transaction.ts).
mongoose.set('transactionAsyncLocalStorage', true);

const MAX_CONNECT_ATTEMPTS = 5;
const OUTAGE_ALERT_AFTER_MS = 30_000;

let closing = false;
let outageTimer: NodeJS.Timeout | undefined;

// Scenario 2: a server that answered "no" (bad password, not authorized) won't change its mind,
// and a malformed URI won't fix itself. Only "couldn't reach a server" is worth retrying.
function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return !['MongoServerError', 'MongoParseError', 'MongoAPIError'].includes(err.name);
}

function watchConnection(): void {
  const connection = mongoose.connection;

  // Scenarios 3 and 6: the driver reconnects by itself; we log, and alert on long outages.
  connection.on('disconnected', () => {
    if (closing) return;
    logger.warn('MongoDB disconnected; the driver will keep trying to reconnect');
    outageTimer ??= setTimeout(() => {
      logger.error(
        `MongoDB unreachable for over ${String(OUTAGE_ALERT_AFTER_MS / 1000)} s; /health/ready reports 503`,
      );
    }, OUTAGE_ALERT_AFTER_MS);
  });

  // Scenarios 3 and 5: back online (also fires after an Atlas failover to a new primary).
  connection.on('reconnected', () => {
    clearTimeout(outageTimer);
    outageTimer = undefined;
    logger.info('MongoDB reconnected');
  });

  connection.on('error', (err: unknown) => {
    logger.error({ err }, 'MongoDB connection error');
  });
}

export async function connectToDatabase(): Promise<void> {
  // Scenario 1: retry transient failures with exponential backoff: 1 s, 2 s, 4 s, 8 s.
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(env.MONGODB_URI, {
        // Give up on an attempt after 10 s instead of hanging forever.
        serverSelectionTimeoutMS: 10_000,
        maxPoolSize: 10,
      });
      break;
    } catch (err) {
      if (!isRetryable(err) || attempt === MAX_CONNECT_ATTEMPTS) throw err;

      const delayMs = 1_000 * 2 ** (attempt - 1);
      logger.warn(
        { err, attempt, retryInMs: delayMs },
        `MongoDB connection attempt ${String(attempt)}/${String(MAX_CONNECT_ATTEMPTS)} failed, retrying`,
      );
      await sleep(delayMs);
    }
  }

  // Attach listeners only after the first successful connect, so failed startup attempts
  // don't log misleading "disconnected" warnings.
  watchConnection();
  const { name, host } = mongoose.connection;
  logger.info({ database: name, host }, 'MongoDB connected');

  // Production too: a fresh database must get its unique indexes (one account per email, etc.)
  // before the first request. Existing indexes make this a quick no-op.
  await syncIndexes();
}

// Creates every collection and index declared in the models that doesn't exist yet. Never drops
// anything. Collections must exist before they can be used inside a transaction.
export async function syncIndexes(): Promise<void> {
  for (const name of mongoose.modelNames()) {
    await mongoose.model(name).createCollection();
    await mongoose.model(name).createIndexes();
  }
}

export async function disconnectFromDatabase(): Promise<void> {
  closing = true;
  clearTimeout(outageTimer);
  await mongoose.disconnect();
  logger.info('MongoDB disconnected cleanly');
}

// Used by /health/ready. Reports false instead of throwing, and never waits longer than 1 s.
export async function pingDatabase(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected || !db) return false;

  try {
    await db.command({ ping: 1 }, { timeoutMS: 1_000 });
    return true;
  } catch {
    return false;
  }
}
