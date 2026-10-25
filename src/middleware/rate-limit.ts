// Rate limiters (login, register, forgot password, per-user default) backed by a MongoDB store,
// so limits hold across multiple API instances (NFR-014, OD-07).
import type { Request } from 'express';
import {
  ipKeyGenerator,
  rateLimit,
  type AugmentedRequest,
  type ClientRateLimitInfo,
  type Options,
  type RateLimitRequestHandler,
  type Store,
} from 'express-rate-limit';
import mongoose from 'mongoose';
import { RateLimitedError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';
import { hashToken } from '../lib/tokens.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

interface RateLimitDocument {
  _id: string;
  hits: number;
  expiresAt: Date;
}

let ttlIndexReady: Promise<unknown> | undefined;

// Fixed-window counter: one document per (limiter, key, window), deleted by a TTL index when the
// window ends. `$inc` with upsert is atomic, so concurrent requests can't under-count.
class MongoStore implements Store {
  readonly prefix: string;
  readonly localKeys = false;
  private windowMs = MINUTE_MS;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private get collection() {
    return mongoose.connection.collection<RateLimitDocument>('rateLimits');
  }

  private bucket(key: string): { id: string; resetTime: Date } {
    const windowStart = Math.floor(Date.now() / this.windowMs) * this.windowMs;
    return {
      id: `${this.prefix}:${key}:${String(windowStart)}`,
      resetTime: new Date(windowStart + this.windowMs),
    };
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    // Created lazily on first use: the module loads before the database connection exists.
    ttlIndexReady ??= this.collection
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch((err: unknown) => {
        logger.error({ err }, 'Could not create rateLimits TTL index');
      });

    const { id, resetTime } = this.bucket(key);
    const doc = await this.collection.findOneAndUpdate(
      { _id: id },
      { $inc: { hits: 1 }, $setOnInsert: { expiresAt: resetTime } },
      { upsert: true, returnDocument: 'after' },
    );
    return { totalHits: doc?.hits ?? 1, resetTime };
  }

  async decrement(key: string): Promise<void> {
    const { id } = this.bucket(key);
    await this.collection.updateOne({ _id: id, hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key: string): Promise<void> {
    await this.collection.deleteOne({ _id: this.bucket(key).id });
  }
}

const byIp = (req: Request): string => ipKeyGenerator(req.ip ?? 'unknown');

const byUser = (req: Request): string => req.auth?.userId ?? byIp(req);

// Reads the email from the body before validation, so it must cope with any shape.
const byEmail = (req: Request): string => {
  const body: unknown = req.body;
  return typeof body === 'object' &&
    body !== null &&
    'email' in body &&
    typeof body.email === 'string'
    ? body.email.trim().toLowerCase()
    : '';
};

const byIpAndEmail = (req: Request): string => `${byIp(req)}:${byEmail(req)}`;

// Scripts on Google's servers share IPs, so key by the bearer token presented (hashed, never stored raw).
const byBearer = (req: Request): string => hashToken(req.get('authorization') ?? '');

function limiter(
  name: string,
  windowMs: number,
  limit: number,
  keyGenerator: (req: Request) => string,
  extra: Partial<Options> = {},
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    store: new MongoStore(name),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Hand off to our error handler so a 429 uses the standard error envelope.
    handler: (req, _res, next) => {
      // express-rate-limit attaches its counters to the request under the `rateLimit` key.
      const info = (req as AugmentedRequest).rateLimit;
      const resetTime = info?.resetTime?.getTime() ?? Date.now() + windowMs;
      next(new RateLimitedError(Math.max(1, Math.ceil((resetTime - Date.now()) / 1000))));
    },
    ...extra,
  });
}

// Login: 5 failures per (IP + email) stops guessing one account; 20 per IP stops spraying many.
// Successful logins don't count, so a user who finally types the right password isn't punished.
export const loginLimiters = [
  limiter('login-ip', 15 * MINUTE_MS, 20, byIp),
  limiter('login-ip-email', 15 * MINUTE_MS, 5, byIpAndEmail, { skipSuccessfulRequests: true }),
];
export const registerLimiter = limiter('register-ip', HOUR_MS, 5, byIp);
export const forgotPasswordLimiters = [
  limiter('forgot-ip', HOUR_MS, 10, byIp),
  limiter('forgot-email', HOUR_MS, 3, byEmail),
];
export const verifyEmailLimiter = limiter('verify-email-ip', HOUR_MS, 10, byIp);
export const resetPasswordLimiter = limiter('reset-password-ip', HOUR_MS, 10, byIp);
export const resendVerificationLimiter = limiter('resend-verification-user', HOUR_MS, 3, byUser);
// Endpoints that check the current password (change password, delete account) can be used to
// guess it, so they get login-like limits per user.
export const passwordCheckLimiter = limiter('password-check-user', 15 * MINUTE_MS, 5, byUser, {
  skipSuccessfulRequests: true,
});
// Imports and exports read or write thousands of rows: expensive endpoints get tighter limits.
export const importLimiter = limiter('import-user', HOUR_MS, 10, byUser);
export const exportLimiter = limiter('export-user', HOUR_MS, 20, byUser);
// The Gmail script calls every 5 minutes, in batches of 20: 120 calls per hour leaves headroom.
export const captureIngestLimiter = limiter('capture-ingest-token', HOUR_MS, 120, byBearer);
// Default for every authenticated route.
export const userRateLimit = limiter('user-default', MINUTE_MS, 300, byUser);
