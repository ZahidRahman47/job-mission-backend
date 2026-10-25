// Application rules: creation with inline company, status transitions in a transaction,
// set-once milestones, optimistic concurrency, archive, interviews, notes, contact links
// (FR-021 to FR-034).
import { withTransaction } from '../../db/transaction.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.ts';
import { pageMeta, type PageMeta } from '../../lib/pagination.ts';
import { addDays, parseLocalDate, zonedMidnight } from '../../lib/time.ts';
import * as activitiesService from '../activities/activities.service.ts';
import type { ActivityView } from '../activities/activities.schemas.ts';
import * as companiesService from '../companies/companies.service.ts';
import * as contactsService from '../contacts/contacts.service.ts';
import * as remindersService from '../reminders/reminders.service.ts';
import * as usersService from '../users/users.service.ts';
import type { ApplicationStatus } from './applications.constants.ts';
import type { ApplicationRecord, InterviewRecord } from './applications.model.ts';
import * as applicationsRepository from './applications.repository.ts';
import type { ApplicationFilter, ListRow } from './applications.repository.ts';
import type {
  ApplicationDetailView,
  ApplicationListItemView,
  ApplicationView,
  CreateApplicationInput,
  ExportApplicationsQuery,
  InterviewInput,
  InterviewUpdateInput,
  ListApplicationsQuery,
  UpdateApplicationInput,
} from './applications.schemas.ts';
import {
  allowedTransitions,
  initialMilestones,
  isReopen,
  milestonesReached,
} from './status-machine.ts';

// --- views ------------------------------------------------------------------------------------

const iso = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;

function interviewView(interview: InterviewRecord) {
  return {
    id: interview._id.toString(),
    round: interview.round,
    type: interview.type,
    scheduledAt: iso(interview.scheduledAt),
    durationMinutes: interview.durationMinutes ?? null,
    interviewers: interview.interviewers,
    outcome: interview.outcome,
    notes: interview.notes,
  };
}

function baseView(app: ListRow | ApplicationRecord) {
  return {
    id: app._id.toString(),
    companyId: app.companyId.toString(),
    companyName: app.companyName,
    title: app.title,
    location: app.location ?? null,
    workMode: app.workMode ?? null,
    employmentType: app.employmentType ?? null,
    salary: app.salary
      ? {
          min: app.salary.min ?? null,
          max: app.salary.max ?? null,
          currency: app.salary.currency,
          period: app.salary.period,
        }
      : null,
    jobUrl: app.jobUrl ?? null,
    source: app.source,
    priority: app.priority,
    status: app.status,
    previousStatus: app.previousStatus ?? null,
    appliedAt: iso(app.appliedAt),
    milestones: {
      respondedAt: iso(app.milestones.respondedAt),
      screeningAt: iso(app.milestones.screeningAt),
      interviewAt: iso(app.milestones.interviewAt),
      offerAt: iso(app.milestones.offerAt),
      closedAt: iso(app.milestones.closedAt),
    },
    nextFollowUpAt: iso(app.nextFollowUpAt),
    contactIds: app.contactIds.map((id) => id.toString()),
    archivedAt: iso(app.archivedAt),
    version: app.version,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
  };
}

export function toApplicationView(app: ApplicationRecord): ApplicationView {
  return {
    ...baseView(app),
    jobDescription: app.jobDescription ?? null,
    interviews: app.interviews.map(interviewView),
  };
}

function toListItemView(row: ListRow): ApplicationListItemView {
  return { ...baseView(row), interviewCount: row.interviewCount };
}

// --- helpers ----------------------------------------------------------------------------------

// "2026-10-25" means local midnight in the user's timezone; full timestamps are taken as-is.
function toInstant(value: string, timezone: string): Date {
  return value.length === 10 ? zonedMidnight(parseLocalDate(value), timezone) : new Date(value);
}

async function getOwnedOrThrow(userId: string, id: string): Promise<ApplicationRecord> {
  const app = await applicationsRepository.findOwned(userId, id);
  if (!app) throw new NotFoundError('Application');
  return app;
}

// For timeline entries: who/what, captured at write time so the feed needs no joins.
function snapshot(app: Pick<ApplicationRecord, 'title' | 'companyName'>) {
  return { applicationTitle: app.title, companyName: app.companyName };
}

async function toFilter(
  userId: string,
  query: ListApplicationsQuery | ExportApplicationsQuery,
): Promise<ApplicationFilter> {
  const needsTimezone = query.appliedFrom !== undefined || query.appliedTo !== undefined;
  const timezone = needsTimezone ? await usersService.getTimezone(userId) : 'UTC';
  return {
    q: query.q,
    statuses: query.status,
    priorities: query.priority,
    sources: query.source,
    location: query.location,
    companyId: query.companyId,
    archived: query.archived,
    appliedFrom: query.appliedFrom
      ? zonedMidnight(parseLocalDate(query.appliedFrom), timezone)
      : undefined,
    // Inclusive end date: everything before the following local midnight.
    appliedTo: query.appliedTo
      ? zonedMidnight(addDays(parseLocalDate(query.appliedTo), 1), timezone)
      : undefined,
  };
}

// --- CRUD -------------------------------------------------------------------------------------

export async function create(
  userId: string,
  input: CreateApplicationInput,
): Promise<ApplicationView> {
  const timezone = await usersService.getTimezone(userId);
  const now = new Date();
  let appliedAt = input.appliedAt ? toInstant(input.appliedAt, timezone) : null;
  // FR-022: anything past "saved" has an applied date; default to now.
  if (input.status !== 'saved' && appliedAt === null) appliedAt = now;

  return withTransaction(async () => {
    const company = input.companyId
      ? await companiesService.getOwnedOrThrow(userId, input.companyId)
      : await companiesService.findOrCreateByName(userId, input.companyName ?? '');

    const app = await applicationsRepository.create({
      userId: company.userId,
      companyId: company._id,
      companyName: company.name,
      title: input.title,
      jobDescription: input.jobDescription ?? null,
      location: input.location ?? null,
      workMode: input.workMode ?? null,
      employmentType: input.employmentType ?? null,
      salary: input.salary
        ? {
            min: input.salary.min ?? null,
            max: input.salary.max ?? null,
            currency: input.salary.currency,
            period: input.salary.period,
          }
        : null,
      jobUrl: input.jobUrl ?? null,
      source: input.source,
      priority: input.priority,
      status: input.status,
      appliedAt,
      milestones: initialMilestones(input.status, appliedAt ?? now),
    });

    await activitiesService.record({
      userId,
      type: 'created',
      applicationId: app._id.toString(),
      data: { status: app.status, ...snapshot(app) },
    });
    return toApplicationView(app);
  });
}

export async function list(
  userId: string,
  query: ListApplicationsQuery,
): Promise<{ data: ApplicationListItemView[]; meta: PageMeta }> {
  const { items, total } = await applicationsRepository.list(
    userId,
    await toFilter(userId, query),
    { field: query.sort, order: query.order },
    { page: query.page, limit: query.limit },
  );
  return { data: items.map(toListItemView), meta: pageMeta(query.page, query.limit, total) };
}

export async function getDetail(userId: string, id: string): Promise<ApplicationDetailView> {
  const app = await getOwnedOrThrow(userId, id);
  const [contacts, pendingReminders] = await Promise.all([
    contactsService.listByIds(
      userId,
      app.contactIds.map((contactId) => contactId.toString()),
    ),
    remindersService.listPendingForApplication(userId, id),
  ]);
  return { ...toApplicationView(app), contacts, pendingReminders };
}

export async function update(
  userId: string,
  id: string,
  input: UpdateApplicationInput,
): Promise<ApplicationView> {
  const { version, companyId, companyName, appliedAt, salary, ...rest } = input;
  const current = await getOwnedOrThrow(userId, id);

  if (appliedAt === null && current.status !== 'saved') {
    throw new ValidationError([
      {
        location: 'body',
        path: ['appliedAt'],
        message: 'Required once the application is past "saved".',
      },
    ]);
  }
  const timezone = appliedAt ? await usersService.getTimezone(userId) : 'UTC';

  return withTransaction(async () => {
    const fields: Record<string, unknown> = { ...rest };
    if (appliedAt !== undefined)
      fields.appliedAt = appliedAt === null ? null : toInstant(appliedAt, timezone);
    if (salary !== undefined) {
      fields.salary =
        salary === null
          ? null
          : {
              min: salary.min ?? null,
              max: salary.max ?? null,
              currency: salary.currency,
              period: salary.period,
            };
    }
    if (companyId !== undefined || companyName !== undefined) {
      const company = companyId
        ? await companiesService.getOwnedOrThrow(userId, companyId)
        : await companiesService.findOrCreateByName(userId, companyName ?? '');
      fields.companyId = company._id;
      fields.companyName = company.name;
    }

    const updated = await applicationsRepository.updateIfVersion(userId, id, version, fields);
    if (!updated) {
      throw new ConflictError(
        'CONFLICT',
        'This application was changed since you loaded it. Reload and try again.',
        { currentVersion: current.version },
      );
    }
    return toApplicationView(updated);
  });
}

export async function remove(userId: string, id: string): Promise<void> {
  await withTransaction(async () => {
    if (!(await applicationsRepository.deleteOwned(userId, id)))
      throw new NotFoundError('Application');
    await activitiesService.deleteForApplication(userId, id);
    await remindersService.deleteForApplication(userId, id);
  });
}

// --- status (FR-027, FR-028, BR-001 to BR-005) ------------------------------------------------

export async function changeStatus(
  userId: string,
  id: string,
  to: ApplicationStatus,
  version: number,
  appliedAtInput: string | undefined,
): Promise<ApplicationView> {
  const timezone = appliedAtInput ? await usersService.getTimezone(userId) : 'UTC';

  return withTransaction(async () => {
    const current = await getOwnedOrThrow(userId, id);
    // The client must have seen the current state. Without this, a transaction retried after a
    // write conflict would re-validate against a state the user never saw, and apply anyway.
    if (current.version !== version) {
      throw new ConflictError(
        'CONFLICT',
        'This application was changed since you loaded it. Reload and try again.',
        { currentVersion: current.version, currentStatus: current.status },
      );
    }
    const from = current.status;
    const allowed = allowedTransitions(from, current.previousStatus);

    if (!allowed.includes(to)) {
      throw new ConflictError(
        'INVALID_STATUS_TRANSITION',
        `Cannot move an application from "${from}" to "${to}".`,
        { from, to, allowed },
      );
    }

    const now = new Date();
    const appliedAt =
      current.appliedAt === null && to !== 'saved'
        ? appliedAtInput
          ? toInstant(appliedAtInput, timezone)
          : now
        : undefined;

    const updated = await applicationsRepository.changeStatus(userId, id, from, version, {
      status: to,
      previousStatus: from,
      ...(appliedAt && { appliedAt }),
      milestones: milestonesReached(to, now, current.milestones),
    });
    // Another request changed the status between our read and this write (BR-004).
    if (!updated) {
      throw new ConflictError(
        'CONFLICT',
        'The status was changed by another request. Reload and try again.',
      );
    }

    await activitiesService.record({
      userId,
      type: isReopen(from, to, current.previousStatus) ? 'reopened' : 'status_changed',
      applicationId: id,
      occurredAt: now,
      data: { from, to, ...snapshot(updated) },
    });
    return toApplicationView(updated);
  });
}

// --- archive (FR-029) -------------------------------------------------------------------------

async function setArchived(
  userId: string,
  id: string,
  archived: boolean,
): Promise<ApplicationView> {
  return withTransaction(async () => {
    const changed = await applicationsRepository.setArchived(userId, id, archived);
    // Already in that state: succeed without a duplicate timeline entry (idempotent).
    if (!changed) return toApplicationView(await getOwnedOrThrow(userId, id));
    await activitiesService.record({
      userId,
      type: archived ? 'archived' : 'restored',
      applicationId: id,
      data: snapshot(changed),
    });
    return toApplicationView(changed);
  });
}

export const archive = (userId: string, id: string) => setArchived(userId, id, true);
export const restore = (userId: string, id: string) => setArchived(userId, id, false);

// --- timeline and notes (FR-030, FR-033) ------------------------------------------------------

export async function listTimeline(
  userId: string,
  id: string,
  cursor: string | undefined,
  limit: number,
) {
  await getOwnedOrThrow(userId, id);
  return activitiesService.listForApplication(userId, id, cursor, limit);
}

export async function addNote(
  userId: string,
  id: string,
  body: string,
  occurredAt: Date | undefined,
): Promise<ActivityView> {
  const app = await getOwnedOrThrow(userId, id);
  return activitiesService.record({
    userId,
    type: 'note',
    applicationId: id,
    occurredAt: occurredAt ?? new Date(),
    data: { body, ...snapshot(app) },
  });
}

export async function updateNote(userId: string, id: string, noteId: string, body: string) {
  await getOwnedOrThrow(userId, id);
  return activitiesService.updateNote(userId, id, noteId, body);
}

export async function deleteNote(userId: string, id: string, noteId: string): Promise<void> {
  await getOwnedOrThrow(userId, id);
  await activitiesService.deleteNote(userId, id, noteId);
}

// --- interviews (FR-031) ----------------------------------------------------------------------

export async function addInterview(
  userId: string,
  id: string,
  input: InterviewInput,
): Promise<ApplicationView> {
  return withTransaction(async () => {
    const updated = await applicationsRepository.pushInterview(userId, id, {
      round: input.round,
      type: input.type,
      scheduledAt: input.scheduledAt ?? null,
      durationMinutes: input.durationMinutes ?? null,
      interviewers: input.interviewers,
      outcome: input.outcome,
      notes: input.notes,
    });
    if (!updated) {
      await getOwnedOrThrow(userId, id);
      throw new ConflictError(
        'TOO_MANY_INTERVIEWS',
        'An application can have at most 20 interview rounds.',
      );
    }
    await activitiesService.record({
      userId,
      type: 'interview_added',
      applicationId: id,
      data: {
        round: input.round,
        interviewType: input.type,
        scheduledAt: iso(input.scheduledAt),
        ...snapshot(updated),
      },
    });
    return toApplicationView(updated);
  });
}

export async function updateInterview(
  userId: string,
  id: string,
  interviewId: string,
  input: InterviewUpdateInput,
): Promise<ApplicationView> {
  return withTransaction(async () => {
    const updated = await applicationsRepository.updateInterview(userId, id, interviewId, input);
    if (!updated) {
      await getOwnedOrThrow(userId, id);
      throw new NotFoundError('Interview');
    }
    const interview = updated.interviews.find((item) => item._id.toString() === interviewId);
    await activitiesService.record({
      userId,
      type: 'interview_updated',
      applicationId: id,
      data: {
        round: interview?.round,
        interviewType: interview?.type,
        outcome: interview?.outcome,
        changed: Object.keys(input),
        ...snapshot(updated),
      },
    });
    return toApplicationView(updated);
  });
}

export async function removeInterview(
  userId: string,
  id: string,
  interviewId: string,
): Promise<ApplicationView> {
  const updated = await applicationsRepository.removeInterview(userId, id, interviewId);
  if (!updated) {
    await getOwnedOrThrow(userId, id);
    throw new NotFoundError('Interview');
  }
  return toApplicationView(updated);
}

// --- contacts (FR-032) ------------------------------------------------------------------------

export async function setContacts(
  userId: string,
  id: string,
  contactIds: string[],
): Promise<ApplicationView> {
  const unique = [...new Set(contactIds)];
  // Every id must be one of the caller's contacts: an IDOR via the request body otherwise.
  await contactsService.assertAllOwned(userId, unique);
  const updated = await applicationsRepository.setContacts(userId, id, unique);
  if (!updated) throw new NotFoundError('Application');
  return toApplicationView(updated);
}

// --- used by other modules --------------------------------------------------------------------

export async function getSummaryOrThrow(
  userId: string,
  id: string,
): Promise<{ id: string; title: string; companyName: string }> {
  const app = await getOwnedOrThrow(userId, id);
  return { id: app._id.toString(), title: app.title, companyName: app.companyName };
}

export async function exportList(
  userId: string,
  query: ExportApplicationsQuery,
  maxRows: number,
): Promise<ApplicationRecord[]> {
  return applicationsRepository.listForExport(userId, await toFilter(userId, query), maxRows);
}

export async function exportAll(userId: string): Promise<ApplicationView[]> {
  return (await applicationsRepository.listAllForUser(userId)).map(toApplicationView);
}

export const {
  countForCompany,
  countsByCompany,
  renameCompany,
  unlinkContact,
  setNextFollowUp,
  deleteAllForUser,
  cohortSummary,
  countsByPeriod,
  countsBySource,
  upcomingInterviews,
  listImportKeySources,
  insertMany,
} = applicationsRepository;
