// Request and response shapes for applications, interviews, notes and contact links.
import { z } from 'zod';
import { pageMetaSchema } from '../../lib/pagination.ts';
import {
  csvListSchema,
  cursorQueryFields,
  instantSchema,
  localDateSchema,
  objectIdSchema,
  optionalText,
  pageQueryFields,
} from '../../lib/schemas.ts';
import { contactSchema } from '../contacts/contacts.schemas.ts';
import { reminderSchema } from '../reminders/reminders.schemas.ts';
import {
  APPLICATION_STATUSES,
  EMPLOYMENT_TYPES,
  INTERVIEW_OUTCOMES,
  INTERVIEW_TYPES,
  MAX_CONTACTS_PER_APPLICATION,
  PRIORITIES,
  SALARY_PERIODS,
  SOURCES,
  WORK_MODES,
} from './applications.constants.ts';

// --- inputs -----------------------------------------------------------------------------------

// A date ("2026-10-25", read in the user's timezone) or an exact instant with offset.
export const appliedAtInput = z
  .union([localDateSchema, z.iso.datetime({ offset: true })])
  .meta({ examples: ['2026-10-25'] });

const salaryInput = z
  .strictObject({
    min: z.number().int().min(0).max(100_000_000).nullable().optional(),
    max: z.number().int().min(0).max(100_000_000).nullable().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Must be an ISO 4217 code like USD.')
      .meta({ examples: ['EUR'] }),
    period: z.enum(SALARY_PERIODS),
  })
  .refine((s) => s.min == null || s.max == null || s.min <= s.max, {
    message: 'min must be less than or equal to max.',
    path: ['min'],
  });

const editableFields = {
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .meta({ examples: ['Senior Backend Engineer'] }),
  jobDescription: optionalText(20_000),
  location: optionalText(200).meta({ examples: ['Berlin (hybrid)'] }),
  workMode: z.enum(WORK_MODES).nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
  salary: salaryInput.nullable().optional(),
  jobUrl: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .nullable()
    .optional()
    .meta({ examples: ['https://jobs.acme.example/123'] }),
  appliedAt: appliedAtInput.nullable().optional(),
};

const oneCompany = (body: { companyId?: string | undefined; companyName?: string | undefined }) =>
  !(body.companyId !== undefined && body.companyName !== undefined);

export const createApplicationBody = z
  .strictObject({
    companyId: objectIdSchema.optional().meta({ description: 'An existing company…' }),
    companyName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .meta({
        description: '…or a name: reused if it exists, created if not.',
        examples: ['Acme Corp'],
      }),
    ...editableFields,
    source: z.enum(SOURCES).default('other'),
    priority: z.enum(PRIORITIES).default('medium'),
    status: z.enum(APPLICATION_STATUSES).default('saved'),
  })
  .refine((b) => oneCompany(b) && (b.companyId !== undefined || b.companyName !== undefined), {
    message: 'Send exactly one of companyId or companyName.',
    path: ['companyId'],
  })
  .meta({ id: 'CreateApplicationRequest' });

export const updateApplicationBody = z
  .strictObject({
    version: z.number().int().min(0).meta({ description: 'The `version` you last read (FR-025).' }),
    companyId: objectIdSchema.optional(),
    companyName: z.string().trim().min(1).max(200).optional(),
    ...editableFields,
    title: editableFields.title.optional(),
    source: z.enum(SOURCES).optional(),
    priority: z.enum(PRIORITIES).optional(),
  })
  .refine(oneCompany, {
    message: 'Send at most one of companyId or companyName.',
    path: ['companyId'],
  })
  .refine((b) => Object.keys(b).length > 1, 'Send at least one field to update besides version.')
  .meta({ id: 'UpdateApplicationRequest' });

export const SORT_FIELDS = [
  'appliedAt',
  'companyName',
  'status',
  'nextFollowUpAt',
  'createdAt',
] as const;

export const listApplicationsQuery = z
  .strictObject({
    q: z.string().trim().min(1).max(100).optional().meta({ description: 'Company or job title.' }),
    status: csvListSchema(APPLICATION_STATUSES).optional(),
    priority: csvListSchema(PRIORITIES).optional(),
    source: csvListSchema(SOURCES).optional(),
    location: z.string().trim().min(1).max(100).optional(),
    companyId: objectIdSchema.optional(),
    appliedFrom: localDateSchema.optional().meta({ description: 'Inclusive, your timezone.' }),
    appliedTo: localDateSchema.optional().meta({ description: 'Inclusive, your timezone.' }),
    archived: z.enum(['exclude', 'only', 'include']).default('exclude'),
    sort: z.enum(SORT_FIELDS).default('appliedAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    ...pageQueryFields,
  })
  .refine((q) => !q.appliedFrom || !q.appliedTo || q.appliedFrom <= q.appliedTo, {
    message: 'appliedFrom must be on or before appliedTo.',
    path: ['appliedFrom'],
  });

// Same filters as the list, without paging or sorting: used by the CSV export.
export const exportApplicationsQuery = z.strictObject({
  q: z.string().trim().min(1).max(100).optional(),
  status: csvListSchema(APPLICATION_STATUSES).optional(),
  priority: csvListSchema(PRIORITIES).optional(),
  source: csvListSchema(SOURCES).optional(),
  location: z.string().trim().min(1).max(100).optional(),
  companyId: objectIdSchema.optional(),
  appliedFrom: localDateSchema.optional(),
  appliedTo: localDateSchema.optional(),
  archived: z.enum(['exclude', 'only', 'include']).default('include'),
});

export const statusChangeBody = z
  .strictObject({
    to: z.enum(APPLICATION_STATUSES),
    version: z.number().int().min(0).meta({
      description: 'The `version` you last read. A newer one means someone else changed it: 409.',
    }),
    appliedAt: appliedAtInput
      .optional()
      .meta({ description: 'When leaving `saved`; defaults to now.' }),
  })
  .meta({ id: 'StatusChangeRequest' });

export const interviewBody = z
  .strictObject({
    round: z.number().int().min(1).max(50),
    type: z.enum(INTERVIEW_TYPES),
    scheduledAt: instantSchema.nullable().optional(),
    durationMinutes: z.number().int().min(5).max(600).nullable().optional(),
    interviewers: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
    outcome: z.enum(INTERVIEW_OUTCOMES).default('pending'),
    notes: z.string().max(5000).default(''),
  })
  .meta({ id: 'InterviewRequest' });

export const interviewUpdateBody = z
  .strictObject({
    round: z.number().int().min(1).max(50).optional(),
    type: z.enum(INTERVIEW_TYPES).optional(),
    scheduledAt: instantSchema.nullable().optional(),
    durationMinutes: z.number().int().min(5).max(600).nullable().optional(),
    interviewers: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
    outcome: z.enum(INTERVIEW_OUTCOMES).optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to update.')
  .meta({ id: 'InterviewUpdateRequest' });

export const setContactsBody = z
  .strictObject({ contactIds: z.array(objectIdSchema).max(MAX_CONTACTS_PER_APPLICATION) })
  .meta({ id: 'SetContactsRequest' });

export const interviewParams = z.strictObject({ id: objectIdSchema, interviewId: objectIdSchema });
export const noteParams = z.strictObject({ id: objectIdSchema, noteId: objectIdSchema });
export const timelineQuery = z.strictObject(cursorQueryFields);

export type CreateApplicationInput = z.infer<typeof createApplicationBody>;
export type UpdateApplicationInput = z.infer<typeof updateApplicationBody>;
export type ListApplicationsQuery = z.infer<typeof listApplicationsQuery>;
export type ExportApplicationsQuery = z.infer<typeof exportApplicationsQuery>;
export type InterviewInput = z.infer<typeof interviewBody>;
export type InterviewUpdateInput = z.infer<typeof interviewUpdateBody>;

// --- outputs ----------------------------------------------------------------------------------

const nullableDate = z.iso.datetime().nullable();

export const interviewSchema = z
  .object({
    id: objectIdSchema,
    round: z.number().int(),
    type: z.enum(INTERVIEW_TYPES),
    scheduledAt: nullableDate,
    durationMinutes: z.number().int().nullable(),
    interviewers: z.array(z.string()),
    outcome: z.enum(INTERVIEW_OUTCOMES),
    notes: z.string(),
  })
  .meta({ id: 'Interview' });

export const milestonesSchema = z
  .object({
    respondedAt: nullableDate,
    screeningAt: nullableDate,
    interviewAt: nullableDate,
    offerAt: nullableDate,
    closedAt: nullableDate,
  })
  .meta({ id: 'Milestones' });

export const applicationSchema = z
  .object({
    id: objectIdSchema,
    companyId: objectIdSchema,
    companyName: z.string(),
    title: z.string(),
    jobDescription: z.string().nullable(),
    location: z.string().nullable(),
    workMode: z.enum(WORK_MODES).nullable(),
    employmentType: z.enum(EMPLOYMENT_TYPES).nullable(),
    salary: z
      .object({
        min: z.number().nullable(),
        max: z.number().nullable(),
        currency: z.string(),
        period: z.enum(SALARY_PERIODS),
      })
      .nullable(),
    jobUrl: z.string().nullable(),
    source: z.enum(SOURCES),
    priority: z.enum(PRIORITIES),
    status: z.enum(APPLICATION_STATUSES),
    previousStatus: z.enum(APPLICATION_STATUSES).nullable(),
    appliedAt: nullableDate,
    milestones: milestonesSchema,
    nextFollowUpAt: nullableDate,
    contactIds: z.array(objectIdSchema),
    interviews: z.array(interviewSchema),
    archivedAt: nullableDate,
    version: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Application' });

export const applicationListItemSchema = applicationSchema
  .omit({ jobDescription: true, interviews: true })
  .extend({ interviewCount: z.number().int() })
  .meta({ id: 'ApplicationListItem' });

export const applicationDetailSchema = applicationSchema
  .extend({
    contacts: z.array(contactSchema),
    pendingReminders: z.array(reminderSchema),
  })
  .meta({ id: 'ApplicationDetail' });

export type ApplicationView = z.infer<typeof applicationSchema>;
export type ApplicationListItemView = z.infer<typeof applicationListItemSchema>;
export type ApplicationDetailView = z.infer<typeof applicationDetailSchema>;

export const applicationResponseSchema = z
  .object({ data: applicationSchema })
  .meta({ id: 'ApplicationResponse' });
export const applicationDetailResponseSchema = z
  .object({ data: applicationDetailSchema })
  .meta({ id: 'ApplicationDetailResponse' });
export const applicationListResponseSchema = z
  .object({ data: z.array(applicationListItemSchema), meta: pageMetaSchema })
  .meta({ id: 'ApplicationListResponse' });
