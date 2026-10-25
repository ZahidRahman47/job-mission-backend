// Company queries, always scoped by userId.
import { escapeRegex } from '../../lib/validation.ts';
import { CompanyModel, type CompanyRecord } from './companies.model.ts';

export interface CompanyFields {
  name?: string;
  normalizedName?: string;
  website?: string | null;
  industry?: string | null;
  location?: string | null;
  notes?: string | null;
}

export async function create(
  userId: string,
  fields: CompanyFields & { name: string; normalizedName: string },
): Promise<CompanyRecord> {
  const [company] = await CompanyModel.create([{ userId, ...fields }]);
  if (!company) throw new Error('Company insert returned nothing');
  return company.toObject<CompanyRecord>();
}

export function findOwned(userId: string, id: string): Promise<CompanyRecord | null> {
  return CompanyModel.findOne({ _id: id, userId }).lean<CompanyRecord>().exec();
}

export function findByNormalizedName(
  userId: string,
  normalizedName: string,
): Promise<CompanyRecord | null> {
  return CompanyModel.findOne({ userId, normalizedName }).lean<CompanyRecord>().exec();
}

export async function list(
  userId: string,
  options: { prefix?: string; page: number; limit: number },
): Promise<{ items: CompanyRecord[]; total: number }> {
  const filter = {
    userId,
    ...(options.prefix !== undefined && {
      normalizedName: { $regex: `^${escapeRegex(options.prefix)}` },
    }),
  };
  const [items, total] = await Promise.all([
    CompanyModel.find(filter)
      .sort({ normalizedName: 1, _id: 1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit)
      .lean<CompanyRecord[]>()
      .exec(),
    CompanyModel.countDocuments(filter).exec(),
  ]);
  return { items, total };
}

export function updateOwned(
  userId: string,
  id: string,
  fields: CompanyFields,
): Promise<CompanyRecord | null> {
  return CompanyModel.findOneAndUpdate(
    { _id: id, userId },
    { $set: fields },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<CompanyRecord>()
    .exec();
}

export async function deleteOwned(userId: string, id: string): Promise<boolean> {
  return (await CompanyModel.deleteOne({ _id: id, userId }).exec()).deletedCount === 1;
}

export async function deleteAllForUser(userId: string): Promise<void> {
  await CompanyModel.deleteMany({ userId }).exec();
}

export function listAllForUser(userId: string): Promise<CompanyRecord[]> {
  return CompanyModel.find({ userId }).sort({ normalizedName: 1 }).lean<CompanyRecord[]>().exec();
}
