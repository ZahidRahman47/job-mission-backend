// Auth business rules: enumeration-safe responses, session creation/revocation, single-use token
// flows, password changes and account deletion (FR-001 to FR-016). No HTTP knowledge here.
import { isIP } from 'node:net';
import { env } from '../../config/env.ts';
import {
  InvalidCredentialsError,
  isDuplicateKeyError,
  NotFoundError,
  TokenInvalidError,
  UnauthenticatedError,
} from '../../lib/errors.ts';
import { logger } from '../../lib/logger.ts';
import { mailer } from '../../lib/mailer.ts';
import { generateToken, hashToken } from '../../lib/tokens.ts';
import * as activitiesService from '../activities/activities.service.ts';
import * as applicationsService from '../applications/applications.service.ts';
import * as captureService from '../capture/capture.service.ts';
import * as companiesService from '../companies/companies.service.ts';
import * as contactsService from '../contacts/contacts.service.ts';
import * as importsService from '../imports/imports.service.ts';
import * as remindersService from '../reminders/reminders.service.ts';
import * as usersService from '../users/users.service.ts';
import type { PublicUser } from '../users/users.schemas.ts';
import * as authTokenRepository from './auth-token.repository.ts';
import type { LoginInput, RegisterInput, SessionView } from './auth.schemas.ts';
import { hashPassword, needsRehash, verifyAgainstDummyHash, verifyPassword } from './password.ts';
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from './session-cookie.ts';
import * as sessionRepository from './session.repository.ts';

const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_PASSWORD_TTL_MS = 30 * 60 * 1000;

export interface AuthContext {
  userId: string;
  sessionId: string;
}

export interface ClientInfo {
  userAgent: string | undefined;
  ip: string | undefined;
}

// ---------------------------------------------------------------------------------------------
// Registration (FR-001 to FR-003)
// ---------------------------------------------------------------------------------------------

// The caller always gets the same 202 response, whether or not the email was already registered
// (FR-002). The difference is only visible in the email inbox, which only the owner can read.
export async function register(input: RegisterInput): Promise<void> {
  // Hash first, for every request, so new and existing emails take the same time.
  const passwordHash = await hashPassword(input.password);

  const existing = await usersService.findByEmail(input.email);
  if (existing) {
    await mailer.send({
      to: existing.email,
      subject: 'Someone tried to register with your email',
      text: `Someone tried to create a Mission Control account with this email address. You already have an account, so nothing was changed.\n\nForgot your password? Reset it here: ${env.APP_URL}/forgot-password`,
    });
    return;
  }

  try {
    const user = await usersService.createUser({
      name: input.name,
      email: input.email,
      passwordHash,
      timezone: input.timezone,
    });
    await sendVerificationEmail(user._id.toString(), user.email);
  } catch (err) {
    // Two registrations for the same new email raced; the unique index let only one win.
    if (isDuplicateKeyError(err)) return;
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Login, sessions, logout (FR-005 to FR-009, FR-014)
// ---------------------------------------------------------------------------------------------

export async function login(
  input: LoginInput,
  client: ClientInfo,
): Promise<{ token: string; user: PublicUser }> {
  const user = await usersService.findByEmailWithPassword(input.email);

  if (!user?.passwordHash || user.deletionRequestedAt !== null) {
    await verifyAgainstDummyHash(input.password);
    throw new InvalidCredentialsError();
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw new InvalidCredentialsError();
  }

  const userId = user._id.toString();
  // Transparently upgrade hashes made with older parameters, while we have the plain password.
  if (needsRehash(user.passwordHash)) {
    await usersService.setPasswordHash(userId, await hashPassword(input.password));
  }

  const token = await createSession(userId, client);
  return { token, user: usersService.toPublicUser(user) };
}

async function createSession(userId: string, client: ClientInfo): Promise<string> {
  // A brand-new random token on every login prevents session fixation.
  const token = generateToken();
  const now = Date.now();
  await sessionRepository.create({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(now + SESSION_ABSOLUTE_TTL_MS),
    idleExpiresAt: new Date(now + SESSION_IDLE_TTL_MS),
    lastSeenAt: new Date(now),
    userAgent: client.userAgent?.slice(0, 300) ?? null,
    ipPrefix: toIpPrefix(client.ip),
  });
  return token;
}

// Called by the requireAuth middleware for every authenticated request.
export async function resolveSession(token: string, now = new Date()): Promise<AuthContext> {
  const session = await sessionRepository.findByTokenHash(hashToken(token));
  if (!session) throw new UnauthenticatedError();

  const userId = session.userId.toString();
  const sessionId = session._id.toString();

  // TTL cleanup runs about once a minute, so check expiry ourselves instead of trusting deletion.
  if (now >= session.expiresAt || now >= session.idleExpiresAt) {
    await sessionRepository.deleteOne(userId, sessionId);
    throw new UnauthenticatedError('SESSION_EXPIRED');
  }

  // Slide the idle window, but write at most every 5 minutes instead of on every request.
  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    const idleExpiresAt = new Date(
      Math.min(now.getTime() + SESSION_IDLE_TTL_MS, session.expiresAt.getTime()),
    );
    await sessionRepository.touch(sessionId, now, idleExpiresAt);
  }

  return { userId, sessionId };
}

export async function logout(auth: AuthContext): Promise<void> {
  await sessionRepository.deleteOne(auth.userId, auth.sessionId);
}

export async function logoutAll(auth: AuthContext): Promise<void> {
  await sessionRepository.deleteAllForUser(auth.userId);
}

export async function listSessions(auth: AuthContext): Promise<SessionView[]> {
  const sessions = await sessionRepository.listForUser(auth.userId);
  return sessions.map((session) => ({
    id: session._id.toString(),
    userAgent: session.userAgent ?? null,
    ipPrefix: session.ipPrefix ?? null,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    current: session._id.toString() === auth.sessionId,
  }));
}

// Returns whether the revoked session was the caller's own, so the controller can clear the cookie.
export async function revokeSession(
  auth: AuthContext,
  sessionId: string,
): Promise<{ wasCurrent: boolean }> {
  // Scoped by userId: another user's session id behaves exactly like a non-existent one (404).
  const deleted = await sessionRepository.deleteOne(auth.userId, sessionId);
  if (!deleted) throw new NotFoundError('Session');
  return { wasCurrent: sessionId === auth.sessionId };
}

// ---------------------------------------------------------------------------------------------
// Email verification (FR-003, FR-004)
// ---------------------------------------------------------------------------------------------

async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  // Only the newest link works: requesting a new one invalidates the old ones.
  await authTokenRepository.deleteForUser(userId, 'verify_email');
  const token = generateToken();
  await authTokenRepository.create({
    userId,
    type: 'verify_email',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VERIFY_EMAIL_TTL_MS),
  });
  await mailer.send({
    to: email,
    subject: 'Verify your Mission Control email',
    text: `Confirm your email address (link valid for 24 hours):\n${env.APP_URL}/verify-email?token=${token}`,
  });
}

export async function verifyEmail(token: string): Promise<void> {
  const consumed = await authTokenRepository.consume('verify_email', hashToken(token));
  if (!consumed) throw new TokenInvalidError();
  await usersService.markEmailVerified(consumed.userId.toString());
}

export async function resendVerification(auth: AuthContext): Promise<void> {
  const user = await usersService.findById(auth.userId);
  if (!user) throw new UnauthenticatedError();
  if (user.emailVerifiedAt !== null) return; // already verified: nothing to send
  await sendVerificationEmail(auth.userId, user.email);
}

// ---------------------------------------------------------------------------------------------
// Passwords (FR-011 to FR-013)
// ---------------------------------------------------------------------------------------------

// Always succeeds from the caller's point of view (FR-011): no reply reveals whether the email exists.
export async function forgotPassword(email: string): Promise<void> {
  const user = await usersService.findByEmail(email);
  if (!user || user.deletionRequestedAt !== null) return;

  const userId = user._id.toString();
  await authTokenRepository.deleteForUser(userId, 'reset_password');
  const token = generateToken();
  await authTokenRepository.create({
    userId,
    type: 'reset_password',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_PASSWORD_TTL_MS),
  });
  await mailer.send({
    to: user.email,
    subject: 'Reset your Mission Control password',
    text: `Reset your password (link valid for 30 minutes):\n${env.APP_URL}/reset-password?token=${token}\n\nDidn't ask for this? You can ignore this email; your password is unchanged.`,
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const consumed = await authTokenRepository.consume('reset_password', hashToken(token));
  if (!consumed) throw new TokenInvalidError();

  const userId = consumed.userId.toString();
  const user = await usersService.findById(userId);
  if (!user || user.deletionRequestedAt !== null) throw new TokenInvalidError();

  await usersService.setPasswordHash(userId, await hashPassword(newPassword));
  // Whoever had the old password (maybe an attacker) is logged out everywhere (FR-012).
  await sessionRepository.deleteAllForUser(userId);
  await authTokenRepository.deleteForUser(userId, 'reset_password');
  await sendPasswordChangedEmail(user.email);
}

export async function changePassword(
  auth: AuthContext,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await usersService.findByIdWithPassword(auth.userId);
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new InvalidCredentialsError();
  }

  await usersService.setPasswordHash(auth.userId, await hashPassword(newPassword));
  // Keep this device logged in; sign out every other one (FR-013).
  await sessionRepository.deleteAllForUser(auth.userId, auth.sessionId);
  await sendPasswordChangedEmail(user.email);
}

async function sendPasswordChangedEmail(email: string): Promise<void> {
  await mailer.send({
    to: email,
    subject: 'Your Mission Control password was changed',
    text: `Your password was just changed and other devices were signed out.\n\nIf this wasn't you, reset your password now: ${env.APP_URL}/forgot-password`,
  });
}

// ---------------------------------------------------------------------------------------------
// Account deletion (FR-016, BR-022)
// ---------------------------------------------------------------------------------------------

export async function deleteAccount(auth: AuthContext, password: string): Promise<void> {
  const user = await usersService.findByIdWithPassword(auth.userId);
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    throw new InvalidCredentialsError();
  }
  await purgeAccount(auth.userId);
}

// Idempotent: safe to run again if a previous run was interrupted halfway (BR-022).
// Every module that stores user data must be listed here.
async function purgeAccount(userId: string): Promise<void> {
  await usersService.markDeletionRequested(userId); // 1. blocks login from now on
  await sessionRepository.deleteAllForUser(userId); // 2. logs out every device
  await authTokenRepository.deleteForUser(userId); // 3. kills outstanding email links
  // 4. all product data, children before parents
  await activitiesService.deleteAllForUser(userId);
  await remindersService.deleteAllForUser(userId);
  await applicationsService.deleteAllForUser(userId);
  await contactsService.deleteAllForUser(userId);
  await companiesService.deleteAllForUser(userId);
  await importsService.deleteAllForUser(userId);
  await captureService.deleteAllForUser(userId);
  await usersService.deleteUser(userId); // 5. the user document itself, last
}

// Run at startup: finishes deletions that were interrupted by a crash or deploy.
export async function resumePendingDeletions(): Promise<void> {
  for (const userId of await usersService.findIdsPendingDeletion()) {
    logger.warn({ userId }, 'Resuming interrupted account deletion');
    await purgeAccount(userId);
  }
}

// ---------------------------------------------------------------------------------------------

// Store only the network part of the IP: /24 for IPv4, /48 for IPv6.
function toIpPrefix(ip: string | undefined): string | null {
  if (ip === undefined) return null;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) return `${v4.split('.').slice(0, 3).join('.')}.0/24`;
  if (isIP(ip) === 6) return `${ip.split(':').slice(0, 3).join(':')}::/48`;
  return null;
}
