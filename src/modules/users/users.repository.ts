// User queries (by email, by id). Never returns passwordHash unless a *WithPassword function is used.
// For this collection the user *is* the owner, so `userId` is the document's own _id.
import { UserModel, type UserRecord } from './users.model.ts';

export function findById(userId: string): Promise<UserRecord | null> {
  return UserModel.findById(userId).lean<UserRecord>().exec();
}

export function findByIdWithPassword(userId: string): Promise<UserRecord | null> {
  return UserModel.findById(userId).select('+passwordHash').lean<UserRecord>().exec();
}

export function findByEmail(email: string): Promise<UserRecord | null> {
  return UserModel.findOne({ email }).lean<UserRecord>().exec();
}

export function findByEmailWithPassword(email: string): Promise<UserRecord | null> {
  return UserModel.findOne({ email }).select('+passwordHash').lean<UserRecord>().exec();
}

export async function create(input: {
  name: string;
  email: string;
  passwordHash: string;
  timezone: string;
}): Promise<UserRecord> {
  const user = await UserModel.create(input);
  return user.toObject<UserRecord>();
}

// The $set objects below are built from validated, typed input only; never from req.body directly.
export function updateFields(
  userId: string,
  fields: Record<string, unknown>,
): Promise<UserRecord | null> {
  return UserModel.findOneAndUpdate(
    { _id: userId },
    { $set: fields },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<UserRecord>()
    .exec();
}

export async function setPasswordHash(userId: string, passwordHash: string): Promise<void> {
  await UserModel.updateOne({ _id: userId }, { $set: { passwordHash } }).exec();
}

export async function markEmailVerified(userId: string): Promise<void> {
  await UserModel.updateOne(
    { _id: userId, emailVerifiedAt: null },
    { $set: { emailVerifiedAt: new Date() } },
  ).exec();
}

export async function markDeletionRequested(userId: string): Promise<void> {
  await UserModel.updateOne(
    { _id: userId, deletionRequestedAt: null },
    { $set: { deletionRequestedAt: new Date() } },
  ).exec();
}

export async function deleteById(userId: string): Promise<void> {
  await UserModel.deleteOne({ _id: userId }).exec();
}

export async function findIdsPendingDeletion(): Promise<string[]> {
  const users = await UserModel.find({ deletionRequestedAt: { $ne: null } }, { _id: 1 })
    .lean<{ _id: UserRecord['_id'] }[]>()
    .exec();
  return users.map((user) => user._id.toString());
}
