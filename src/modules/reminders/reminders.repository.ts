// Reminder queries (overdue/today/upcoming), always scoped by userId.
import { ReminderModel, type ReminderRecord } from './reminders.model.ts';

export interface ReminderFields {
  title?: string;
  note?: string;
  dueAt?: Date;
  applicationId?: string | null;
}

export async function create(
  userId: string,
  fields: Required<Pick<ReminderFields, 'title' | 'note' | 'dueAt'>> & {
    applicationId: string | null;
  },
): Promise<ReminderRecord> {
  const [reminder] = await ReminderModel.create([{ userId, ...fields }]);
  if (!reminder) throw new Error('Reminder insert returned nothing');
  return reminder.toObject<ReminderRecord>();
}

export function findOwned(userId: string, id: string): Promise<ReminderRecord | null> {
  return ReminderModel.findOne({ _id: id, userId }).lean<ReminderRecord>().exec();
}

export async function list(
  userId: string,
  filter: Record<string, unknown>,
  sort: Record<string, 1 | -1>,
  page: { page: number; limit: number },
): Promise<{ items: ReminderRecord[]; total: number }> {
  const query = { userId, ...filter };
  const [items, total] = await Promise.all([
    ReminderModel.find(query)
      .sort({ ...sort, _id: 1 })
      .skip((page.page - 1) * page.limit)
      .limit(page.limit)
      .lean<ReminderRecord[]>()
      .exec(),
    ReminderModel.countDocuments(query).exec(),
  ]);
  return { items, total };
}

export function updateOwned(
  userId: string,
  id: string,
  fields: ReminderFields,
): Promise<ReminderRecord | null> {
  return ReminderModel.findOneAndUpdate(
    { _id: id, userId },
    { $set: fields },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<ReminderRecord>()
    .exec();
}

// Conditional on the current status, so completing twice is a no-op rather than a double event.
export function setStatus(
  userId: string,
  id: string,
  from: 'pending' | 'completed',
  to: 'pending' | 'completed',
): Promise<ReminderRecord | null> {
  return ReminderModel.findOneAndUpdate(
    { _id: id, userId, status: from },
    { $set: { status: to, completedAt: to === 'completed' ? new Date() : null } },
    { returnDocument: 'after' },
  )
    .lean<ReminderRecord>()
    .exec();
}

export function deleteOwned(userId: string, id: string): Promise<ReminderRecord | null> {
  return ReminderModel.findOneAndDelete({ _id: id, userId }).lean<ReminderRecord>().exec();
}

export async function earliestPendingDueAt(
  userId: string,
  applicationId: string,
): Promise<Date | null> {
  const next = await ReminderModel.findOne({ userId, applicationId, status: 'pending' })
    .sort({ dueAt: 1 })
    .select({ dueAt: 1 })
    .lean<Pick<ReminderRecord, 'dueAt'>>()
    .exec();
  return next?.dueAt ?? null;
}

export function listPendingForApplication(
  userId: string,
  applicationId: string,
): Promise<ReminderRecord[]> {
  return ReminderModel.find({ userId, applicationId, status: 'pending' })
    .sort({ dueAt: 1 })
    .limit(50)
    .lean<ReminderRecord[]>()
    .exec();
}

export function countPendingBefore(userId: string, before: Date): Promise<number> {
  return ReminderModel.countDocuments({ userId, status: 'pending', dueAt: { $lt: before } }).exec();
}

export function listPendingBetween(
  userId: string,
  from: Date | null,
  to: Date,
  limit: number,
): Promise<ReminderRecord[]> {
  return ReminderModel.find({
    userId,
    status: 'pending',
    dueAt: { ...(from && { $gte: from }), $lt: to },
  })
    .sort({ dueAt: 1 })
    .limit(limit)
    .lean<ReminderRecord[]>()
    .exec();
}

export async function deleteForApplication(userId: string, applicationId: string): Promise<void> {
  await ReminderModel.deleteMany({ userId, applicationId }).exec();
}

export async function deleteAllForUser(userId: string): Promise<void> {
  await ReminderModel.deleteMany({ userId }).exec();
}

export function listAllForUser(userId: string): Promise<ReminderRecord[]> {
  return ReminderModel.find({ userId }).sort({ dueAt: 1 }).lean<ReminderRecord[]>().exec();
}
