// Session queries: find by token hash, revoke one/all, slide idle expiry.
// Every query except findByTokenHash is scoped by userId (the token lookup *is* the authentication).
import { SessionModel, type SessionRecord } from './session.model.ts';

export async function create(input: {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  idleExpiresAt: Date;
  lastSeenAt: Date;
  userAgent: string | null;
  ipPrefix: string | null;
}): Promise<SessionRecord> {
  const session = await SessionModel.create(input);
  return session.toObject<SessionRecord>();
}

export function findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
  return SessionModel.findOne({ tokenHash }).lean<SessionRecord>().exec();
}

export function listForUser(userId: string): Promise<SessionRecord[]> {
  return SessionModel.find({ userId }).sort({ lastSeenAt: -1 }).lean<SessionRecord[]>().exec();
}

export async function touch(
  sessionId: string,
  lastSeenAt: Date,
  idleExpiresAt: Date,
): Promise<void> {
  await SessionModel.updateOne({ _id: sessionId }, { $set: { lastSeenAt, idleExpiresAt } }).exec();
}

// Returns false when nothing matched: the session doesn't exist or belongs to someone else.
export async function deleteOne(userId: string, sessionId: string): Promise<boolean> {
  const result = await SessionModel.deleteOne({ _id: sessionId, userId }).exec();
  return result.deletedCount === 1;
}

export async function deleteAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
  await SessionModel.deleteMany({
    userId,
    ...(exceptSessionId !== undefined && { _id: { $ne: exceptSessionId } }),
  }).exec();
}
