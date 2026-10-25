// Request and response shapes for activities and notes.
import { z } from 'zod';
import { cursorMetaSchema } from '../../lib/pagination.ts';
import { cursorQueryFields, instantSchema, objectIdSchema } from '../../lib/schemas.ts';
import { ACTIVITY_TYPES } from './activities.model.ts';

export const activitySchema = z
  .object({
    id: objectIdSchema,
    type: z.enum(ACTIVITY_TYPES),
    applicationId: objectIdSchema.nullable(),
    contactId: objectIdSchema.nullable(),
    occurredAt: z.iso.datetime(),
    data: z.record(z.string(), z.unknown()).meta({
      description:
        'Type-specific details, e.g. `{ from, to }` for status_changed or `{ body }` for note. Includes `applicationTitle` and `companyName` snapshots.',
    }),
  })
  .meta({ id: 'Activity' });

export type ActivityView = z.infer<typeof activitySchema>;

export const activityListResponseSchema = z
  .object({ data: z.array(activitySchema), meta: cursorMetaSchema })
  .meta({ id: 'ActivityListResponse' });

export const activityResponseSchema = z
  .object({ data: activitySchema })
  .meta({ id: 'ActivityResponse' });

export const feedQuery = z.strictObject(cursorQueryFields);

export const noteBody = z
  .strictObject({
    body: z.string().trim().min(1).max(5000),
    occurredAt: instantSchema.optional(),
  })
  .meta({ id: 'NoteRequest' });

export const noteUpdateBody = z
  .strictObject({ body: z.string().trim().min(1).max(5000) })
  .meta({ id: 'NoteUpdateRequest' });
