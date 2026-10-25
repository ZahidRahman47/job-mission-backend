// Capture token and inbound email queries, always scoped by userId.
import {
  CaptureTokenModel,
  InboundEmailModel,
  type CaptureOutcome,
  type CaptureTokenRecord,
  type InboundEmailRecord,
} from './capture.model.ts';

export function findToken(userId: string): Promise<CaptureTokenRecord | null> {
  return CaptureTokenModel.findOne({ userId }).lean<CaptureTokenRecord>().exec();
}

// Replaces any previous token: the old one stops working in the same write.
export function replaceToken(userId: string, tokenHash: string): Promise<CaptureTokenRecord> {
  return CaptureTokenModel.findOneAndUpdate(
    { userId },
    { $set: { tokenHash, lastUsedAt: null, createdAt: new Date() } },
    { upsert: true, returnDocument: 'after', timestamps: false },
  )
    .lean<CaptureTokenRecord>()
    .exec();
}

export async function deleteToken(userId: string): Promise<boolean> {
  const result = await CaptureTokenModel.deleteOne({ userId }).exec();
  return result.deletedCount > 0;
}

// Looks the token up by hash and records the use in one round trip.
export function useToken(tokenHash: string): Promise<CaptureTokenRecord | null> {
  return CaptureTokenModel.findOneAndUpdate(
    { tokenHash },
    { $set: { lastUsedAt: new Date() } },
    { returnDocument: 'after' },
  )
    .lean<CaptureTokenRecord>()
    .exec();
}

export type NewInboundEmail = Pick<
  InboundEmailRecord,
  | 'gmailId'
  | 'threadId'
  | 'direction'
  | 'from'
  | 'to'
  | 'subject'
  | 'text'
  | 'htmlText'
  | 'sentAt'
  | 'expiresAt'
>;

// Inserts the emails not seen before. An email sent again that no rule matched last time is
// refreshed (it may now carry its HTML part) and queued again, so improved rules pick it up.
export async function storeEmails(
  userId: string,
  emails: NewInboundEmail[],
): Promise<{ stored: number; requeued: number }> {
  if (emails.length === 0) return { stored: 0, requeued: 0 };
  const inserted = await InboundEmailModel.bulkWrite(
    emails.map((email) => ({
      updateOne: {
        filter: { userId, gmailId: email.gmailId },
        update: { $setOnInsert: { userId, ...email, state: 'received', attempts: 0 } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  const insertedIds = new Set(
    Object.keys(inserted.upsertedIds).map((index) => emails[Number(index)]?.gmailId),
  );
  const resent = emails.filter((email) => !insertedIds.has(email.gmailId));
  if (resent.length === 0) return { stored: inserted.upsertedCount, requeued: 0 };

  const requeued = await InboundEmailModel.bulkWrite(
    resent.map((email) => ({
      updateOne: {
        filter: { userId, gmailId: email.gmailId, state: 'ignored', outcome: 'no_rule' },
        update: {
          $set: {
            text: email.text,
            htmlText: email.htmlText,
            state: 'received',
            attempts: 0,
            outcome: null,
            error: null,
          },
        },
      },
    })),
    { ordered: false },
  );
  return { stored: inserted.upsertedCount, requeued: requeued.modifiedCount };
}

// Claims the oldest waiting email (or one whose lease ran out) so two requests never process the same one.
export function leaseNext(userId: string, leaseMs: number): Promise<InboundEmailRecord | null> {
  const now = new Date();
  return InboundEmailModel.findOneAndUpdate(
    {
      userId,
      $or: [{ state: 'received' }, { state: 'processing', leaseUntil: { $lt: now } }],
    },
    {
      $set: { state: 'processing', leaseUntil: new Date(now.getTime() + leaseMs) },
      $inc: { attempts: 1 },
    },
    { sort: { sentAt: 1 }, returnDocument: 'after' },
  )
    .lean<InboundEmailRecord>()
    .exec();
}

export async function finish(
  id: InboundEmailRecord['_id'],
  update: {
    state: InboundEmailRecord['state'];
    outcome?: CaptureOutcome | null;
    applicationId?: string | null;
    error?: string | null;
  },
): Promise<void> {
  await InboundEmailModel.updateOne({ _id: id }, { $set: { ...update, leaseUntil: null } }).exec();
}

export async function deleteAllForUser(userId: string): Promise<void> {
  await InboundEmailModel.deleteMany({ userId }).exec();
  await CaptureTokenModel.deleteMany({ userId }).exec();
}
