// Contact queries, always scoped by userId.
import { escapeRegex } from '../../lib/validation.ts';
import { ContactModel, type ContactRecord } from './contacts.model.ts';

export interface ContactFields {
  name?: string;
  companyId?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  notes?: string | null;
}

export async function create(
  userId: string,
  fields: ContactFields & { name: string },
): Promise<ContactRecord> {
  const [contact] = await ContactModel.create([{ userId, ...fields }]);
  if (!contact) throw new Error('Contact insert returned nothing');
  return contact.toObject<ContactRecord>();
}

export function findOwned(userId: string, id: string): Promise<ContactRecord | null> {
  return ContactModel.findOne({ _id: id, userId }).lean<ContactRecord>().exec();
}

export async function list(
  userId: string,
  options: { q?: string; companyId?: string; page: number; limit: number },
): Promise<{ items: ContactRecord[]; total: number }> {
  const filter = {
    userId,
    ...(options.companyId !== undefined && { companyId: options.companyId }),
    ...(options.q !== undefined && { name: { $regex: escapeRegex(options.q), $options: 'i' } }),
  };
  const [items, total] = await Promise.all([
    ContactModel.find(filter)
      .sort({ name: 1, _id: 1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit)
      .lean<ContactRecord[]>()
      .exec(),
    ContactModel.countDocuments(filter).exec(),
  ]);
  return { items, total };
}

export function listForCompany(userId: string, companyId: string): Promise<ContactRecord[]> {
  return ContactModel.find({ userId, companyId })
    .sort({ name: 1 })
    .limit(100)
    .lean<ContactRecord[]>()
    .exec();
}

export function countOwned(userId: string, ids: string[]): Promise<number> {
  return ContactModel.countDocuments({ userId, _id: { $in: ids } }).exec();
}

export function listByIds(userId: string, ids: string[]): Promise<ContactRecord[]> {
  return ContactModel.find({ userId, _id: { $in: ids } })
    .lean<ContactRecord[]>()
    .exec();
}

export function updateOwned(
  userId: string,
  id: string,
  fields: ContactFields,
): Promise<ContactRecord | null> {
  return ContactModel.findOneAndUpdate(
    { _id: id, userId },
    { $set: fields },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<ContactRecord>()
    .exec();
}

export async function detachCompany(userId: string, companyId: string): Promise<void> {
  await ContactModel.updateMany({ userId, companyId }, { $set: { companyId: null } }).exec();
}

export async function deleteOwned(userId: string, id: string): Promise<boolean> {
  return (await ContactModel.deleteOne({ _id: id, userId }).exec()).deletedCount === 1;
}

export async function deleteAllForUser(userId: string): Promise<void> {
  await ContactModel.deleteMany({ userId }).exec();
}

export function listAllForUser(userId: string): Promise<ContactRecord[]> {
  return ContactModel.find({ userId }).sort({ name: 1 }).lean<ContactRecord[]>().exec();
}
