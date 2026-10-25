// Dashboard metrics from the applications and reminders services. No collection of its own.
// Every formula matches requirements.md 4 exactly; tests pin them with the US-08 fixture.
import { ValidationError } from '../../lib/errors.ts';
import {
  addDays,
  addMonths,
  formatLocalDate,
  localDateOf,
  parseLocalDate,
  weekdayIndex,
  zonedMidnight,
  type LocalDate,
} from '../../lib/time.ts';
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from '../applications/applications.constants.ts';
import * as applicationsService from '../applications/applications.service.ts';
import * as remindersService from '../reminders/reminders.service.ts';
import * as usersService from '../users/users.service.ts';
import {
  MAX_RANGE_DAYS,
  type SourceStats,
  type Summary,
  type Timeseries,
  type Upcoming,
} from './analytics.schemas.ts';

const DEFAULT_RANGE_DAYS = 90;
const UPCOMING_DAYS = 7;
const UPCOMING_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

interface ResolvedRange {
  timezone: string;
  fromDate: LocalDate;
  toDate: LocalDate;
  start: Date; // local midnight of `from`, in UTC
  end: Date; // local midnight *after* `to`, so `to` is inclusive
}

// null instead of a division by zero, rounded to 4 decimals (0.3333).
export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 10_000;
}

async function resolveRange(userId: string, from?: string, to?: string): Promise<ResolvedRange> {
  const timezone = await usersService.getTimezone(userId);
  const toDate = to ? parseLocalDate(to) : localDateOf(new Date(), timezone);
  const fromDate = from ? parseLocalDate(from) : addDays(toDate, -(DEFAULT_RANGE_DAYS - 1));
  const start = zonedMidnight(fromDate, timezone);
  const end = zonedMidnight(addDays(toDate, 1), timezone);
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new ValidationError([
      { location: 'query', path: ['from'], message: 'The range can be at most 2 years.' },
    ]);
  }
  return { timezone, fromDate, toDate, start, end };
}

const rangeView = (range: ResolvedRange) => ({
  from: formatLocalDate(range.fromDate),
  to: formatLocalDate(range.toDate),
});

export async function summary(userId: string, from?: string, to?: string): Promise<Summary> {
  const range = await resolveRange(userId, from, to);
  const [cohort, followUpsDue] = await Promise.all([
    applicationsService.cohortSummary(userId, range.start, range.end),
    remindersService.countDueByEndOfToday(userId, range.timezone),
  ]);

  const byStatus = Object.fromEntries(
    APPLICATION_STATUSES.map((status) => [status, cohort.byStatus[status] ?? 0]),
  ) as Record<ApplicationStatus, number>;

  return {
    range: rangeView(range),
    total: cohort.total,
    activePipeline: cohort.active,
    responseRate: rate(cohort.responded, cohort.total),
    interviewRate: rate(cohort.interviewed, cohort.total),
    offerRate: rate(cohort.offered, cohort.total),
    offerPerInterview: rate(cohort.offered, cohort.interviewed),
    byStatus,
    followUpsDue,
  };
}

// Applications over time, with empty weeks/months filled in as 0 so charts have no gaps.
export async function timeseries(
  userId: string,
  interval: 'week' | 'month',
  from?: string,
  to?: string,
): Promise<Timeseries> {
  const range = await resolveRange(userId, from, to);
  const [rows, weeklyGoal] = await Promise.all([
    applicationsService.countsByPeriod(userId, range.start, range.end, interval, range.timezone),
    usersService.getWeeklyGoal(userId),
  ]);
  const counts = new Map(rows.map((row) => [row._id.getTime(), row.count]));

  const buckets: Timeseries['buckets'] = [];
  let cursor =
    interval === 'week'
      ? addDays(range.fromDate, -weekdayIndex(range.fromDate)) // back to Monday
      : { ...range.fromDate, day: 1 };
  while (formatLocalDate(cursor) <= formatLocalDate(range.toDate)) {
    const start = zonedMidnight(cursor, range.timezone);
    buckets.push({
      start: start.toISOString(),
      label: formatLocalDate(cursor),
      count: counts.get(start.getTime()) ?? 0,
    });
    cursor = interval === 'week' ? addDays(cursor, 7) : addMonths(cursor, 1);
  }

  return { range: rangeView(range), interval, weeklyGoal, buckets };
}

export async function sources(userId: string, from?: string, to?: string): Promise<SourceStats> {
  const range = await resolveRange(userId, from, to);
  const rows = await applicationsService.countsBySource(userId, range.start, range.end);
  return rows.map((row) => ({
    source: row._id as SourceStats[number]['source'],
    total: row.total,
    responded: row.responded,
    interviewed: row.interviewed,
    responseRate: rate(row.responded, row.total),
    interviewRate: rate(row.interviewed, row.total),
  }));
}

// "What needs me now": not limited to the selected range (requirements.md 4).
export async function upcoming(userId: string): Promise<Upcoming> {
  const timezone = await usersService.getTimezone(userId);
  const now = new Date();
  const [reminders, interviews] = await Promise.all([
    remindersService.dashboardLists(userId, timezone, UPCOMING_LIMIT),
    applicationsService.upcomingInterviews(
      userId,
      now,
      new Date(now.getTime() + UPCOMING_DAYS * DAY_MS),
      UPCOMING_LIMIT,
    ),
  ]);
  return {
    overdueReminders: reminders.overdue,
    todayReminders: reminders.today,
    interviews: interviews.map((row) => ({
      applicationId: row.applicationId.toString(),
      title: row.title,
      companyName: row.companyName,
      interview: {
        id: row.interview._id.toString(),
        round: row.interview.round,
        type: row.interview.type,
        scheduledAt: row.interview.scheduledAt?.toISOString() ?? null,
        durationMinutes: row.interview.durationMinutes ?? null,
        interviewers: row.interview.interviewers,
        outcome: row.interview.outcome,
        notes: row.interview.notes,
      },
    })),
  };
}
