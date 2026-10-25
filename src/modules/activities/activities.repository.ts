// Activity queries with cursor pagination, always scoped by userId.
import { Types } from 'mongoose';
import type { Cursor } from '../../lib/pagination.ts';
import { ActivityModel, type ActivityRecord, type ActivityType } from './activities.model.ts';

export interface NewActivity {
  userId: string;
  type: ActivityType;
  applicationId?: string | null;
  contactId?: string | null;
  data?: Record<string, unknown>;
  occurredAt?: Date;
}

function toDocument(activity: NewActivity) {
  return {
    userId: activity.userId,
    type: activity.type,
    applicationId: activity.applicationId ?? null,
    contactId: activity.contactId ?? null,
    data: activity.data ?? {},
    occurredAt: activity.occurredAt ?? new Date(),
  };
}

export async function insert(activity: NewActivity): Promise<ActivityRecord> {
  const [created] = await ActivityModel.create([toDocument(activity)]);
  if (!created) throw new Error('Activity insert returned nothing');
  return created.toObject<ActivityRecord>();
}

export async function insertMany(activities: NewActivity[]): Promise<void> {
  if (activities.length === 0) return;
  await ActivityModel.insertMany(activities.map(toDocument), { ordered: false });
}

// Newest first. Fetches one extra item to know whether another page exists.
export async function listPage(
  userId: string,
  filter: { applicationId?: string; contactId?: string },
  cursor: Cursor | undefined,
  limit: number,
): Promise<{ items: ActivityRecord[]; hasMore: boolean }> {
  const query: Record<string, unknown> = { userId, ...filter };
  if (cursor) {
    const cursorId = new Types.ObjectId(cursor.id);
    query.$or = [
      { occurredAt: { $lt: cursor.at } },
      { occurredAt: cursor.at, _id: { $lt: cursorId } },
    ];
  }
  const items = await ActivityModel.find(query)
    .sort({ occurredAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<ActivityRecord[]>()
    .exec();
  return { items: items.slice(0, limit), hasMore: items.length > limit };
}

export function findNote(
  userId: string,
  applicationId: string,
  noteId: string,
): Promise<ActivityRecord | null> {
  return ActivityModel.findOne({ _id: noteId, userId, applicationId, type: 'note' })
    .lean<ActivityRecord>()
    .exec();
}

export function updateNoteBody(
  userId: string,
  applicationId: string,
  noteId: string,
  body: string,
): Promise<ActivityRecord | null> {
  return ActivityModel.findOneAndUpdate(
    { _id: noteId, userId, applicationId, type: 'note' },
    { $set: { 'data.body': body } },
    { returnDocument: 'after' },
  )
    .lean<ActivityRecord>()
    .exec();
}

export async function deleteNote(
  userId: string,
  applicationId: string,
  noteId: string,
): Promise<boolean> {
  const result = await ActivityModel.deleteOne({
    _id: noteId,
    userId,
    applicationId,
    type: 'note',
  });
  return result.deletedCount === 1;
}

export async function deleteForApplication(userId: string, applicationId: string): Promise<void> {
  await ActivityModel.deleteMany({ userId, applicationId }).exec();
}

export async function deleteAllForUser(userId: string): Promise<void> {
  await ActivityModel.deleteMany({ userId }).exec();
}

export function listAllForUser(userId: string): Promise<ActivityRecord[]> {
  return ActivityModel.find({ userId }).sort({ occurredAt: -1 }).lean<ActivityRecord[]>().exec();
}
