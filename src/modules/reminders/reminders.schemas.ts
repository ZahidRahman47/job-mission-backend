// Request and response shapes for reminders.
import { z } from 'zod';
import { pageMetaSchema } from '../../lib/pagination.ts';
import { instantSchema, objectIdSchema, pageQueryFields } from '../../lib/schemas.ts';

export const REMINDER_VIEWS = ['overdue', 'today', 'upcoming', 'completed'] as const;

export const createReminderBody = z
  .strictObject({
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .meta({ examples: ['Follow up with the recruiter'] }),
    note: z.string().trim().max(2000).default(''),
    dueAt: instantSchema.meta({ description: 'Stored in UTC, truncated to the minute.' }),
    applicationId: objectIdSchema.nullable().optional(),
  })
  .meta({ id: 'CreateReminderRequest' });

export const updateReminderBody = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().max(2000).optional(),
    dueAt: instantSchema.optional(),
    applicationId: objectIdSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to update.')
  .meta({ id: 'UpdateReminderRequest' });

export const listRemindersQuery = z.strictObject({
  view: z.enum(REMINDER_VIEWS).default('upcoming').meta({
    description:
      'overdue: pending and due before now. today: pending, due from now until the end of today (your timezone). upcoming: pending, due in the 7 days after today. completed: most recently completed first.',
  }),
  applicationId: objectIdSchema.optional(),
  ...pageQueryFields,
});

export const reminderSchema = z
  .object({
    id: objectIdSchema,
    applicationId: objectIdSchema.nullable(),
    title: z.string(),
    note: z.string(),
    dueAt: z.iso.datetime(),
    status: z.enum(['pending', 'completed']),
    completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    application: z
      .object({ companyName: z.string(), title: z.string() })
      .nullable()
      .optional()
      .meta({
        description:
          'The linked application, on list and dashboard rows (absent on single-reminder responses).',
      }),
  })
  .meta({ id: 'Reminder' });

export type ReminderView = z.infer<typeof reminderSchema>;

export const reminderCountsResponseSchema = z
  .object({
    data: z.object({
      overdue: z.number().int(),
      today: z.number().int(),
      upcoming: z.number().int(),
      completed: z.number().int(),
    }),
  })
  .meta({ id: 'ReminderCountsResponse' });
export type CreateReminderInput = z.infer<typeof createReminderBody>;
export type UpdateReminderInput = z.infer<typeof updateReminderBody>;

export const reminderResponseSchema = z
  .object({ data: reminderSchema })
  .meta({ id: 'ReminderResponse' });
export const reminderListResponseSchema = z
  .object({ data: z.array(reminderSchema), meta: pageMetaSchema })
  .meta({ id: 'ReminderListResponse' });
