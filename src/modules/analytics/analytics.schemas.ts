// Request and response shapes for the dashboard metrics (requirements.md 4).
import { z } from 'zod';
import { localDateSchema, objectIdSchema } from '../../lib/schemas.ts';
import { APPLICATION_STATUSES, SOURCES } from '../applications/applications.constants.ts';
import { interviewSchema } from '../applications/applications.schemas.ts';
import { reminderSchema } from '../reminders/reminders.schemas.ts';

const MAX_RANGE_DAYS = 731;

const rangeFields = {
  from: localDateSchema
    .optional()
    .meta({ description: 'Inclusive. Default: 89 days before `to`.' }),
  to: localDateSchema
    .optional()
    .meta({ description: 'Inclusive. Default: today (your timezone).' }),
};

const validRange = (q: { from?: string | undefined; to?: string | undefined }) =>
  !q.from || !q.to || q.from <= q.to;

export const rangeQuery = z
  .strictObject(rangeFields)
  .refine(validRange, { message: '`from` must be on or before `to`.', path: ['from'] });

export const timeseriesQuery = z
  .strictObject({ ...rangeFields, interval: z.enum(['week', 'month']).default('week') })
  .refine(validRange, { message: '`from` must be on or before `to`.', path: ['from'] });

export { MAX_RANGE_DAYS };

// A rate in [0, 1], or null when its denominator is 0 (FR-054): "no data" is not "0 %".
const rate = z.number().min(0).max(1).nullable();

const rangeSchema = z.object({ from: z.string(), to: z.string() });

export const summarySchema = z
  .object({
    range: rangeSchema,
    total: z.number().int(),
    activePipeline: z.number().int(),
    responseRate: rate.meta({
      description: 'Applications with any employer response (incl. rejection) / total.',
    }),
    interviewRate: rate.meta({ description: 'Applications that reached an interview / total.' }),
    offerRate: rate.meta({ description: 'Applications that reached an offer / total.' }),
    offerPerInterview: rate.meta({
      description: 'Offers / applications that reached an interview.',
    }),
    byStatus: z.record(z.enum(APPLICATION_STATUSES), z.number().int()),
    followUpsDue: z
      .number()
      .int()
      .meta({ description: 'Pending reminders due by the end of today.' }),
  })
  .meta({ id: 'AnalyticsSummary' });

export const timeseriesSchema = z
  .object({
    range: rangeSchema,
    interval: z.enum(['week', 'month']),
    weeklyGoal: z.number().int(),
    buckets: z.array(
      z.object({
        start: z.iso.datetime(),
        label: z.string().meta({ examples: ['2026-10-19'] }),
        count: z.number().int(),
      }),
    ),
  })
  .meta({ id: 'AnalyticsTimeseries' });

export const sourcesSchema = z
  .array(
    z.object({
      source: z.enum(SOURCES),
      total: z.number().int(),
      responded: z.number().int(),
      interviewed: z.number().int(),
      responseRate: rate,
      interviewRate: rate,
    }),
  )
  .meta({ id: 'AnalyticsSources' });

export const upcomingSchema = z
  .object({
    overdueReminders: z.array(reminderSchema),
    todayReminders: z.array(reminderSchema),
    interviews: z.array(
      z.object({
        applicationId: objectIdSchema,
        title: z.string(),
        companyName: z.string(),
        interview: interviewSchema,
      }),
    ),
  })
  .meta({ id: 'AnalyticsUpcoming' });

export type Summary = z.infer<typeof summarySchema>;
export type Timeseries = z.infer<typeof timeseriesSchema>;
export type SourceStats = z.infer<typeof sourcesSchema>;
export type Upcoming = z.infer<typeof upcomingSchema>;
