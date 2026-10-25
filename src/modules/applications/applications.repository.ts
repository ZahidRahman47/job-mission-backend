// Application queries and aggregations, always scoped by userId.
// Note: aggregate() does not cast strings to ObjectIds like find() does, so ids are converted here.
import { Types, type PipelineStage } from 'mongoose';
import { escapeRegex } from '../../lib/validation.ts';
import {
  ACTIVE_STATUSES,
  APPLICATION_STATUSES,
  MAX_INTERVIEWS,
  type ApplicationStatus,
} from './applications.constants.ts';
import {
  ApplicationModel,
  type ApplicationRecord,
  type InterviewRecord,
} from './applications.model.ts';
import type { Milestones } from './status-machine.ts';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

export interface ApplicationFilter {
  q?: string | undefined;
  statuses?: ApplicationStatus[] | undefined;
  priorities?: string[] | undefined;
  sources?: string[] | undefined;
  location?: string | undefined;
  companyId?: string | undefined;
  appliedFrom?: Date | undefined;
  appliedTo?: Date | undefined;
  archived: 'exclude' | 'only' | 'include';
}

export type ListRow = Omit<ApplicationRecord, 'jobDescription' | 'interviews'> & {
  interviewCount: number;
};

function buildMatch(userId: string, filter: ApplicationFilter): Record<string, unknown> {
  const match: Record<string, unknown> = { userId: oid(userId) };
  if (filter.archived === 'exclude') match.archivedAt = null;
  if (filter.archived === 'only') match.archivedAt = { $ne: null };
  if (filter.statuses) match.status = { $in: filter.statuses };
  if (filter.priorities) match.priority = { $in: filter.priorities };
  if (filter.sources) match.source = { $in: filter.sources };
  if (filter.companyId) match.companyId = oid(filter.companyId);
  if (filter.location) match.location = { $regex: escapeRegex(filter.location), $options: 'i' };
  if (filter.q) {
    const pattern = { $regex: escapeRegex(filter.q), $options: 'i' };
    match.$or = [{ companyName: pattern }, { title: pattern }];
  }
  if (filter.appliedFrom ?? filter.appliedTo) {
    match.appliedAt = {
      ...(filter.appliedFrom && { $gte: filter.appliedFrom }),
      ...(filter.appliedTo && { $lt: filter.appliedTo }),
    };
  }
  return match;
}

const SORT_EXPRESSIONS: Record<string, unknown> = {
  appliedAt: '$appliedAt',
  createdAt: '$createdAt',
  nextFollowUpAt: '$nextFollowUpAt',
  companyName: { $toLower: '$companyName' },
  // Pipeline order (saved -> withdrawn), not alphabetical.
  status: { $indexOfArray: [APPLICATION_STATUSES, '$status'] },
};

// One round trip: filter, sort with nulls last and _id as tiebreak (BR-030, BR-031), then a
// $facet returns both the page and the total count.
export async function list(
  userId: string,
  filter: ApplicationFilter,
  sort: { field: string; order: 'asc' | 'desc' },
  page: { page: number; limit: number },
): Promise<{ items: ListRow[]; total: number }> {
  const direction = sort.order === 'asc' ? 1 : -1;
  const sortValue = SORT_EXPRESSIONS[sort.field] ?? '$appliedAt';
  const pipeline: PipelineStage[] = [
    { $match: buildMatch(userId, filter) },
    {
      $addFields: {
        _sortValue: sortValue,
        _sortIsNull: { $cond: [{ $eq: [{ $ifNull: [sortValue, null] }, null] }, 1, 0] },
      },
    },
    { $sort: { _sortIsNull: 1, _sortValue: direction, _id: direction } },
    {
      $facet: {
        items: [
          { $skip: (page.page - 1) * page.limit },
          { $limit: page.limit },
          { $addFields: { interviewCount: { $size: { $ifNull: ['$interviews', []] } } } },
          { $project: { jobDescription: 0, interviews: 0, _sortValue: 0, _sortIsNull: 0 } },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];
  const [result] = await ApplicationModel.aggregate<{
    items: ListRow[];
    total: { count: number }[];
  }>(pipeline).exec();
  return { items: result?.items ?? [], total: result?.total[0]?.count ?? 0 };
}

export function listForExport(
  userId: string,
  filter: ApplicationFilter,
  maxRows: number,
): Promise<ApplicationRecord[]> {
  return ApplicationModel.find(buildMatch(userId, filter))
    .sort({ appliedAt: -1, _id: -1 })
    .limit(maxRows)
    .lean<ApplicationRecord[]>()
    .exec();
}

export async function create(
  doc: Omit<
    ApplicationRecord,
    | '_id'
    | 'createdAt'
    | 'updatedAt'
    | 'version'
    | 'interviews'
    | 'nextFollowUpAt'
    | 'archivedAt'
    | 'previousStatus'
    | 'contactIds'
  >,
): Promise<ApplicationRecord> {
  const [created] = await ApplicationModel.create([doc]);
  if (!created) throw new Error('Application insert returned nothing');
  return created.toObject<ApplicationRecord>();
}

export async function insertMany(
  docs: Parameters<typeof create>[0][],
): Promise<ApplicationRecord[]> {
  const created = await ApplicationModel.insertMany(docs, { ordered: false });
  return created.map((doc) => doc.toObject<ApplicationRecord>());
}

export function findOwned(userId: string, id: string): Promise<ApplicationRecord | null> {
  return ApplicationModel.findOne({ _id: id, userId }).lean<ApplicationRecord>().exec();
}

export async function existsOwned(userId: string, id: string): Promise<boolean> {
  return (await ApplicationModel.exists({ _id: id, userId }).exec()) !== null;
}

// Conditional update: matches only if the document still has the version the client read.
export function updateIfVersion(
  userId: string,
  id: string,
  version: number,
  fields: Record<string, unknown>,
): Promise<ApplicationRecord | null> {
  return ApplicationModel.findOneAndUpdate(
    { _id: id, userId, version },
    { $set: fields, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<ApplicationRecord>()
    .exec();
}

// Conditional on the current status: of two concurrent transitions only one can match (BR-004).
export function changeStatus(
  userId: string,
  id: string,
  from: ApplicationStatus,
  version: number,
  fields: {
    status: ApplicationStatus;
    previousStatus: ApplicationStatus;
    appliedAt?: Date;
    milestones: Partial<Milestones>;
  },
): Promise<ApplicationRecord | null> {
  const milestoneFields = Object.fromEntries(
    Object.entries(fields.milestones).map(([key, value]) => [`milestones.${key}`, value]),
  );
  return ApplicationModel.findOneAndUpdate(
    { _id: id, userId, status: from, version },
    {
      $set: {
        status: fields.status,
        previousStatus: fields.previousStatus,
        ...(fields.appliedAt && { appliedAt: fields.appliedAt }),
        ...milestoneFields,
      },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' },
  )
    .lean<ApplicationRecord>()
    .exec();
}

// Returns null if nothing changed (already in the requested state, or not found).
export function setArchived(
  userId: string,
  id: string,
  archived: boolean,
): Promise<ApplicationRecord | null> {
  return ApplicationModel.findOneAndUpdate(
    { _id: id, userId, archivedAt: archived ? null : { $ne: null } },
    { $set: { archivedAt: archived ? new Date() : null }, $inc: { version: 1 } },
    { returnDocument: 'after' },
  )
    .lean<ApplicationRecord>()
    .exec();
}

// Atomic limit: the filter only matches while there are fewer than MAX_INTERVIEWS rounds.
export function pushInterview(
  userId: string,
  id: string,
  interview: Omit<InterviewRecord, '_id'>,
): Promise<ApplicationRecord | null> {
  return ApplicationModel.findOneAndUpdate(
    { _id: id, userId, [`interviews.${String(MAX_INTERVIEWS - 1)}`]: { $exists: false } },
    { $push: { interviews: interview }, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<ApplicationRecord>()
    .exec();
}

export function updateInterview(
  userId: string,
  id: string,
  interviewId: string,
  fields: Record<string, unknown>,
): Promise<ApplicationRecord | null> {
  const set = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [`interviews.$.${key}`, value]),
  );
  return ApplicationModel.findOneAndUpdate(
    { _id: id, userId, 'interviews._id': interviewId },
    { $set: set, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<ApplicationRecord>()
    .exec();
}

export function removeInterview(
  userId: string,
  id: string,
  interviewId: string,
): Promise<ApplicationRecord | null> {
  return ApplicationModel.findOneAndUpdate(
    { _id: id, userId, 'interviews._id': interviewId },
    { $pull: { interviews: { _id: oid(interviewId) } }, $inc: { version: 1 } },
    { returnDocument: 'after' },
  )
    .lean<ApplicationRecord>()
    .exec();
}

export function setContacts(
  userId: string,
  id: string,
  contactIds: string[],
): Promise<ApplicationRecord | null> {
  return ApplicationModel.findOneAndUpdate(
    { _id: id, userId },
    { $set: { contactIds: contactIds.map(oid) }, $inc: { version: 1 } },
    { returnDocument: 'after' },
  )
    .lean<ApplicationRecord>()
    .exec();
}

export async function deleteOwned(userId: string, id: string): Promise<boolean> {
  return (await ApplicationModel.deleteOne({ _id: id, userId }).exec()).deletedCount === 1;
}

// --- maintained by other modules (no version bump: not a user edit of this application) ------

export function countForCompany(userId: string, companyId: string): Promise<number> {
  return ApplicationModel.countDocuments({ userId, companyId }).exec();
}

// Application counts for a page of companies in one query (not one count per company).
export async function countsByCompany(
  userId: string,
  companyIds: string[],
): Promise<Map<string, number>> {
  const rows = await ApplicationModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { userId: oid(userId), companyId: { $in: companyIds.map(oid) } } },
    { $group: { _id: '$companyId', count: { $sum: 1 } } },
  ]).exec();
  return new Map(rows.map((row) => [row._id.toString(), row.count]));
}

export async function renameCompany(
  userId: string,
  companyId: string,
  name: string,
): Promise<void> {
  await ApplicationModel.updateMany({ userId, companyId }, { $set: { companyName: name } }).exec();
}

export async function unlinkContact(userId: string, contactId: string): Promise<void> {
  await ApplicationModel.updateMany(
    { userId, contactIds: contactId },
    { $pull: { contactIds: oid(contactId) } },
  ).exec();
}

export async function setNextFollowUp(userId: string, id: string, at: Date | null): Promise<void> {
  await ApplicationModel.updateOne({ _id: id, userId }, { $set: { nextFollowUpAt: at } }).exec();
}

export async function deleteAllForUser(userId: string): Promise<void> {
  await ApplicationModel.deleteMany({ userId }).exec();
}

export function listAllForUser(userId: string): Promise<ApplicationRecord[]> {
  return ApplicationModel.find({ userId })
    .sort({ createdAt: 1 })
    .lean<ApplicationRecord[]>()
    .exec();
}

export function listImportKeySources(
  userId: string,
): Promise<Pick<ApplicationRecord, 'companyName' | 'title' | 'appliedAt'>[]> {
  return ApplicationModel.find({ userId }, { companyName: 1, title: 1, appliedAt: 1 })
    .lean<Pick<ApplicationRecord, 'companyName' | 'title' | 'appliedAt'>[]>()
    .exec();
}

// --- analytics (requirements.md 4) ------------------------------------------------------------

// `$gt: [field, null]` is true only for real dates: false for null *and* for a missing field.
const reached = (field: string) => ({ $cond: [{ $gt: [`$milestones.${field}`, null] }, 1, 0] });

export interface CohortSummary {
  total: number;
  active: number;
  responded: number;
  interviewed: number;
  offered: number;
  byStatus: Partial<Record<ApplicationStatus, number>>;
}

export async function cohortSummary(userId: string, from: Date, to: Date): Promise<CohortSummary> {
  const [result] = await ApplicationModel.aggregate<{
    totals: Omit<CohortSummary, 'byStatus'>[];
    byStatus: { _id: ApplicationStatus; count: number }[];
  }>([
    { $match: { userId: oid(userId), appliedAt: { $gte: from, $lt: to } } },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: { $sum: { $cond: [{ $in: ['$status', ACTIVE_STATUSES] }, 1, 0] } },
              responded: { $sum: reached('respondedAt') },
              interviewed: { $sum: reached('interviewAt') },
              offered: { $sum: reached('offerAt') },
            },
          },
          { $project: { _id: 0 } },
        ],
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
      },
    },
  ]).exec();
  const totals = result?.totals[0] ?? {
    total: 0,
    active: 0,
    responded: 0,
    interviewed: 0,
    offered: 0,
  };
  return {
    ...totals,
    byStatus: Object.fromEntries((result?.byStatus ?? []).map((row) => [row._id, row.count])),
  };
}

// Counts per local week/month. $dateTrunc does the timezone math inside MongoDB.
export function countsByPeriod(
  userId: string,
  from: Date,
  to: Date,
  unit: 'week' | 'month',
  timezone: string,
): Promise<{ _id: Date; count: number }[]> {
  return ApplicationModel.aggregate<{ _id: Date; count: number }>([
    { $match: { userId: oid(userId), appliedAt: { $gte: from, $lt: to } } },
    {
      $group: {
        _id: { $dateTrunc: { date: '$appliedAt', unit, timezone, startOfWeek: 'monday' } },
        count: { $sum: 1 },
      },
    },
  ]).exec();
}

export function countsBySource(
  userId: string,
  from: Date,
  to: Date,
): Promise<{ _id: string; total: number; responded: number; interviewed: number }[]> {
  return ApplicationModel.aggregate<{
    _id: string;
    total: number;
    responded: number;
    interviewed: number;
  }>([
    { $match: { userId: oid(userId), appliedAt: { $gte: from, $lt: to } } },
    {
      $group: {
        _id: '$source',
        total: { $sum: 1 },
        responded: { $sum: reached('respondedAt') },
        interviewed: { $sum: reached('interviewAt') },
      },
    },
    { $sort: { total: -1, _id: 1 } },
  ]).exec();
}

export interface UpcomingInterviewRow {
  applicationId: Types.ObjectId;
  title: string;
  companyName: string;
  interview: InterviewRecord;
}

export function upcomingInterviews(
  userId: string,
  from: Date,
  to: Date,
  limit: number,
): Promise<UpcomingInterviewRow[]> {
  const window = { $gte: from, $lt: to };
  return ApplicationModel.aggregate<UpcomingInterviewRow>([
    { $match: { userId: oid(userId), archivedAt: null, 'interviews.scheduledAt': window } },
    { $unwind: '$interviews' },
    { $match: { 'interviews.scheduledAt': window, 'interviews.outcome': 'pending' } },
    { $sort: { 'interviews.scheduledAt': 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        applicationId: '$_id',
        title: 1,
        companyName: 1,
        interview: '$interviews',
      },
    },
  ]).exec();
}
