// Reminder rules: timezone-aware views, duplicate prevention, and keeping each application's
// nextFollowUpAt equal to its earliest pending reminder (FR-041 to FR-045, BR-010 to BR-013).
import { withTransaction } from '../../db/transaction.ts';
import {
  ConflictError,
  isDuplicateKeyError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.ts';
import { pageMeta, type PageMeta } from '../../lib/pagination.ts';
import { addDays, localDateOf, todayRange, zonedMidnight } from '../../lib/time.ts';
import * as activitiesService from '../activities/activities.service.ts';
import * as applicationsService from '../applications/applications.service.ts';
import * as usersService from '../users/users.service.ts';
import type { ReminderRecord } from './reminders.model.ts';
import * as remindersRepository from './reminders.repository.ts';
import type {
  CreateReminderInput,
  ReminderView,
  REMINDER_VIEWS,
  UpdateReminderInput,
} from './reminders.schemas.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export function toReminderView(reminder: ReminderRecord): ReminderView {
  return {
    id: reminder._id.toString(),
    applicationId: reminder.applicationId?.toString() ?? null,
    title: reminder.title,
    note: reminder.note,
    dueAt: reminder.dueAt.toISOString(),
    status: reminder.status,
    completedAt: reminder.completedAt?.toISOString() ?? null,
    createdAt: reminder.createdAt.toISOString(),
  };
}

// Minute precision makes "same time" duplicates detectable, and BR-013 bounds catch typos.
function normalizeDueAt(dueAt: Date, now = new Date()): Date {
  if (
    dueAt.getTime() < now.getTime() - 365 * DAY_MS ||
    dueAt.getTime() > now.getTime() + 730 * DAY_MS
  ) {
    throw new ValidationError([
      {
        location: 'body',
        path: ['dueAt'],
        message: 'Must be within 1 year in the past and 2 years in the future.',
      },
    ]);
  }
  return new Date(Math.floor(dueAt.getTime() / 60_000) * 60_000);
}

function duplicateError(): ConflictError {
  return new ConflictError(
    'DUPLICATE_REMINDER',
    'There is already a pending reminder for this application at that time.',
  );
}

// BR-012: called inside the same transaction as every reminder change.
async function syncNextFollowUp(userId: string, applicationId: string | null | undefined) {
  if (!applicationId) return;
  const next = await remindersRepository.earliestPendingDueAt(userId, applicationId);
  await applicationsService.setNextFollowUp(userId, applicationId, next);
}

async function getOwnedOrThrow(userId: string, id: string): Promise<ReminderRecord> {
  const reminder = await remindersRepository.findOwned(userId, id);
  if (!reminder) throw new NotFoundError('Reminder');
  return reminder;
}

// Mongo duplicate-key errors abort the transaction; translate them after it has unwound.
async function mapDuplicate<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isDuplicateKeyError(err)) throw duplicateError();
    throw err;
  }
}

export function create(userId: string, input: CreateReminderInput): Promise<ReminderView> {
  const dueAt = normalizeDueAt(input.dueAt);
  return mapDuplicate(() =>
    withTransaction(async () => {
      const applicationId = input.applicationId ?? null;
      // The application must be the caller's own (IDOR via body).
      if (applicationId) await applicationsService.getSummaryOrThrow(userId, applicationId);
      const reminder = await remindersRepository.create(userId, {
        title: input.title,
        note: input.note,
        dueAt,
        applicationId,
      });
      await syncNextFollowUp(userId, applicationId);
      return toReminderView(reminder);
    }),
  );
}

export async function list(
  userId: string,
  query: {
    view: (typeof REMINDER_VIEWS)[number];
    applicationId?: string | undefined;
    page: number;
    limit: number;
  },
): Promise<{ data: ReminderView[]; meta: PageMeta }> {
  const now = new Date();
  const timezone = await usersService.getTimezone(userId);
  const today = localDateOf(now, timezone);
  const endOfToday = zonedMidnight(addDays(today, 1), timezone);
  const scope = query.applicationId ? { applicationId: query.applicationId } : {};

  const views = {
    overdue: { filter: { status: 'pending', dueAt: { $lt: now } }, sort: { dueAt: 1 } },
    today: {
      filter: { status: 'pending', dueAt: { $gte: now, $lt: endOfToday } },
      sort: { dueAt: 1 },
    },
    upcoming: {
      filter: {
        status: 'pending',
        dueAt: { $gte: endOfToday, $lt: zonedMidnight(addDays(today, 8), timezone) },
      },
      sort: { dueAt: 1 },
    },
    completed: { filter: { status: 'completed' }, sort: { completedAt: -1 } },
  } as const;
  const view = views[query.view];

  const { items, total } = await remindersRepository.list(
    userId,
    { ...view.filter, ...scope },
    view.sort,
    query,
  );
  return { data: items.map(toReminderView), meta: pageMeta(query.page, query.limit, total) };
}

export async function get(userId: string, id: string): Promise<ReminderView> {
  return toReminderView(await getOwnedOrThrow(userId, id));
}

export function update(
  userId: string,
  id: string,
  input: UpdateReminderInput,
): Promise<ReminderView> {
  return mapDuplicate(() =>
    withTransaction(async () => {
      const current = await getOwnedOrThrow(userId, id);
      if (input.applicationId)
        await applicationsService.getSummaryOrThrow(userId, input.applicationId);

      const updated = await remindersRepository.updateOwned(userId, id, {
        ...input,
        ...(input.dueAt && { dueAt: normalizeDueAt(input.dueAt) }),
      });
      if (!updated) throw new NotFoundError('Reminder');

      // Re-linking moves the follow-up date off the old application and onto the new one.
      const oldApplicationId = current.applicationId?.toString();
      const newApplicationId = updated.applicationId?.toString();
      await syncNextFollowUp(userId, oldApplicationId);
      if (newApplicationId !== oldApplicationId) await syncNextFollowUp(userId, newApplicationId);
      return toReminderView(updated);
    }),
  );
}

export function complete(userId: string, id: string): Promise<ReminderView> {
  return withTransaction(async () => {
    const updated = await remindersRepository.setStatus(userId, id, 'pending', 'completed');
    if (!updated) return toReminderView(await getOwnedOrThrow(userId, id)); // already completed

    const applicationId = updated.applicationId?.toString();
    if (applicationId) {
      const app = await applicationsService.getSummaryOrThrow(userId, applicationId);
      await activitiesService.record({
        userId,
        type: 'reminder_completed',
        applicationId,
        data: {
          reminderTitle: updated.title,
          applicationTitle: app.title,
          companyName: app.companyName,
        },
      });
      await syncNextFollowUp(userId, applicationId);
    }
    return toReminderView(updated);
  });
}

export function reopen(userId: string, id: string): Promise<ReminderView> {
  return mapDuplicate(() =>
    withTransaction(async () => {
      const updated = await remindersRepository.setStatus(userId, id, 'completed', 'pending');
      if (!updated) return toReminderView(await getOwnedOrThrow(userId, id)); // already pending
      await syncNextFollowUp(userId, updated.applicationId?.toString());
      return toReminderView(updated);
    }),
  );
}

export async function remove(userId: string, id: string): Promise<void> {
  await withTransaction(async () => {
    const deleted = await remindersRepository.deleteOwned(userId, id);
    if (!deleted) throw new NotFoundError('Reminder');
    await syncNextFollowUp(userId, deleted.applicationId?.toString());
  });
}

// --- used by other modules --------------------------------------------------------------------

export async function listPendingForApplication(
  userId: string,
  applicationId: string,
): Promise<ReminderView[]> {
  return (await remindersRepository.listPendingForApplication(userId, applicationId)).map(
    toReminderView,
  );
}

// Dashboard: follow-ups due = everything pending before the end of today (FR-048).
export async function countDueByEndOfToday(userId: string, timezone: string): Promise<number> {
  return remindersRepository.countPendingBefore(userId, todayRange(new Date(), timezone).end);
}

export async function dashboardLists(
  userId: string,
  timezone: string,
  limit: number,
): Promise<{ overdue: ReminderView[]; today: ReminderView[] }> {
  const now = new Date();
  const [overdue, today] = await Promise.all([
    remindersRepository.listPendingBetween(userId, null, now, limit),
    remindersRepository.listPendingBetween(userId, now, todayRange(now, timezone).end, limit),
  ]);
  return { overdue: overdue.map(toReminderView), today: today.map(toReminderView) };
}

export const { deleteForApplication, deleteAllForUser } = remindersRepository;

export async function exportAll(userId: string): Promise<ReminderView[]> {
  return (await remindersRepository.listAllForUser(userId)).map(toReminderView);
}
