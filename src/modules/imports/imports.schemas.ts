// CSV import: the row schema (one CSV line) and the report returned to the client.
import { z } from 'zod';
import { localDateSchema, objectIdSchema } from '../../lib/schemas.ts';
import {
  APPLICATION_STATUSES,
  EMPLOYMENT_TYPES,
  PRIORITIES,
  SALARY_PERIODS,
  SOURCES,
  WORK_MODES,
} from '../applications/applications.constants.ts';

// The template's columns, in order. Headers are matched case-insensitively.
export const IMPORT_COLUMNS = [
  'company',
  'title',
  'status',
  'appliedAt',
  'source',
  'priority',
  'location',
  'workMode',
  'employmentType',
  'jobUrl',
  'salaryMin',
  'salaryMax',
  'salaryCurrency',
  'salaryPeriod',
] as const;

export const REQUIRED_IMPORT_COLUMNS = ['company', 'title'] as const;

// Empty cells mean "not provided".
const blankToUndefined = (value: unknown) => (value === '' ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

// Keys are the lowercased header names produced by parseCsv().
export const importRowSchema = z
  .object({
    company: z.string().min(1, 'Required.').max(200),
    title: z.string().min(1, 'Required.').max(200),
    status: optional(z.enum(APPLICATION_STATUSES)).transform((v) => v ?? 'applied'),
    appliedat: optional(localDateSchema),
    source: optional(z.enum(SOURCES)).transform((v) => v ?? 'other'),
    priority: optional(z.enum(PRIORITIES)).transform((v) => v ?? 'medium'),
    location: optional(z.string().max(200)),
    workmode: optional(z.enum(WORK_MODES)),
    employmenttype: optional(z.enum(EMPLOYMENT_TYPES)),
    joburl: optional(z.url({ protocol: /^https?$/ }).max(2000)),
    salarymin: optional(z.coerce.number().int().min(0)),
    salarymax: optional(z.coerce.number().int().min(0)),
    salarycurrency: optional(z.string().regex(/^[A-Z]{3}$/, 'Must be an ISO 4217 code like USD.')),
    salaryperiod: optional(z.enum(SALARY_PERIODS)),
  })
  .refine(
    (row) =>
      (row.salarymin === undefined && row.salarymax === undefined) ||
      (row.salarycurrency && row.salaryperiod),
    {
      message: 'salaryCurrency and salaryPeriod are required when a salary is given.',
      path: ['salarycurrency'],
    },
  )
  .refine(
    (row) =>
      row.salarymin === undefined || row.salarymax === undefined || row.salarymin <= row.salarymax,
    {
      message: 'salaryMin must be less than or equal to salaryMax.',
      path: ['salarymin'],
    },
  );

export type ImportRow = z.infer<typeof importRowSchema>;

export const importQuery = z.strictObject({
  fileName: z.string().trim().min(1).max(255).optional(),
});

export const importReportSchema = z
  .object({
    id: objectIdSchema,
    fileName: z.string().nullable(),
    totals: z.object({
      rows: z.number().int(),
      created: z.number().int(),
      skipped: z.number().int().meta({ description: 'Duplicates of existing applications.' }),
      failed: z.number().int(),
    }),
    errors: z
      .array(z.object({ row: z.number().int(), column: z.string(), message: z.string() }))
      .meta({ description: 'Row numbers count the header as row 1. At most 500 listed.' }),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'ImportReport' });

export type ImportReportView = z.infer<typeof importReportSchema>;

export const importReportResponseSchema = z
  .object({ data: importReportSchema })
  .meta({ id: 'ImportReportResponse' });
