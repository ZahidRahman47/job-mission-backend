// Email capture (email-capture.md §0, §2): personal ingest tokens, storing the emails the Gmail
// script sends, and turning recognised confirmation emails into applications with a follow-up.
import { AppError } from '../../lib/errors.ts';
import { logger } from '../../lib/logger.ts';
import { generateToken, hashToken } from '../../lib/tokens.ts';
import * as applicationsService from '../applications/applications.service.ts';
import * as remindersService from '../reminders/reminders.service.ts';
import { RAW_EMAIL_TTL_SECONDS, type InboundEmailRecord } from './capture.model.ts';
import * as captureRepository from './capture.repository.ts';
import { extractByRules } from './capture.rules.ts';
import type { IngestGmailBody } from './capture.schemas.ts';

export class CaptureTokenInvalidError extends AppError {
  constructor() {
    super(401, 'CAPTURE_TOKEN_INVALID', 'The capture token is missing, unknown or revoked.');
  }
}

export async function getTokenStatus(userId: string): Promise<{
  active: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}> {
  const token = await captureRepository.findToken(userId);
  return {
    active: token !== null,
    createdAt: token?.createdAt.toISOString() ?? null,
    lastUsedAt: token?.lastUsedAt?.toISOString() ?? null,
  };
}

// Returns the raw token once; only its hash is stored.
export async function createToken(userId: string): Promise<{ token: string; createdAt: string }> {
  const token = generateToken();
  const record = await captureRepository.replaceToken(userId, hashToken(token));
  return { token, createdAt: record.createdAt.toISOString() };
}

export async function revokeToken(userId: string): Promise<void> {
  await captureRepository.deleteToken(userId);
}

export async function authenticate(token: string | undefined): Promise<string> {
  if (!token) throw new CaptureTokenInvalidError();
  const record = await captureRepository.useToken(hashToken(token));
  if (!record) throw new CaptureTokenInvalidError();
  return String(record.userId);
}

export async function ingestGmail(
  userId: string,
  body: IngestGmailBody,
): Promise<{ stored: number; duplicates: number }> {
  const expiresAt = new Date(Date.now() + RAW_EMAIL_TTL_SECONDS * 1000);
  const stored = await captureRepository.insertNewEmails(
    userId,
    body.messages.map((message) => ({
      ...message,
      sentAt: new Date(message.sentAt),
      expiresAt,
    })),
  );
  return { stored, duplicates: body.messages.length - stored };
}

// --- processing (email-capture.md §2) ---------------------------------------------------------

const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;
// Bounds one request's work; anything left is picked up by the next call.
const MAX_PER_RUN = 50;
// An application to the same company and title within this window is the same application.
const DUPLICATE_WINDOW_MS = 90 * 24 * 60 * 60_000;
const FOLLOW_UP_AFTER_MS = 7 * 24 * 60 * 60_000;

// Processes the user's waiting emails, oldest first. Errors are recorded per email, never thrown.
export async function processPending(userId: string): Promise<void> {
  for (let i = 0; i < MAX_PER_RUN; i++) {
    const email = await captureRepository.leaseNext(userId, LEASE_MS);
    if (!email) return;
    try {
      await captureRepository.finish(email._id, await processEmail(userId, email));
    } catch (err) {
      logger.error({ err, inboundEmailId: String(email._id) }, 'Email capture processing failed');
      await captureRepository.finish(email._id, {
        state: email.attempts >= MAX_ATTEMPTS ? 'failed' : 'received',
        error: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
      });
    }
  }
}

async function processEmail(
  userId: string,
  email: InboundEmailRecord,
): Promise<Parameters<typeof captureRepository.finish>[1]> {
  const captured = extractByRules(email);
  if (!captured) return { state: 'ignored', outcome: 'no_rule', error: null };

  const duplicateId = await applicationsService.findRecentDuplicate(
    userId,
    captured.company,
    captured.title,
    new Date(captured.appliedAt.getTime() - DUPLICATE_WINDOW_MS),
  );
  if (duplicateId) {
    return { state: 'processed', outcome: 'duplicate', applicationId: duplicateId, error: null };
  }

  const app = await applicationsService.create(userId, {
    companyName: captured.company,
    title: captured.title,
    location: captured.location,
    appliedAt: captured.appliedAt.toISOString(),
    source: captured.source,
    priority: 'medium',
    status: 'applied',
  });

  // Follow up a week after applying; for an old email that's already past, remind in an hour.
  const followUpAt = Math.max(
    captured.appliedAt.getTime() + FOLLOW_UP_AFTER_MS,
    Date.now() + 60 * 60_000,
  );
  await remindersService.create(userId, {
    title: `Follow up with ${captured.company}`,
    note: '',
    dueAt: new Date(followUpAt),
    applicationId: app.id,
  });

  return { state: 'processed', outcome: 'created', applicationId: app.id, error: null };
}

export async function deleteAllForUser(userId: string): Promise<void> {
  await captureRepository.deleteAllForUser(userId);
}
