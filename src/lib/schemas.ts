// Zod building blocks shared by every module: ids, pagination, dates, comma-separated filters.
import { z } from 'zod';
import { parseLocalDate } from './time.ts';

export const objectIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, 'Must be a valid id.')
  .meta({ examples: ['6720f1c2a1b2c3d4e5f60718'] });

export const idParams = z.strictObject({ id: objectIdSchema });

// Page-based pagination (BR-033): invalid values are rejected, not silently clamped.
export const pageQueryFields = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

// Cursor pagination for feeds that grow at the top (activity timelines).
export const cursorQueryFields = {
  cursor: z.string().max(200).optional().meta({ description: 'From `meta.nextCursor`.' }),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

// A calendar date without time, e.g. "2026-10-25". Interpreted in the user's timezone.
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date like 2026-10-25.')
  .refine((value) => {
    const { year, month, day } = parseLocalDate(value);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'Must be a real calendar date.')
  .meta({ examples: ['2026-10-25'] });

// An instant in time with an explicit offset or Z, e.g. "2026-10-25T09:30:00+05:00".
export const instantSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .meta({ examples: ['2026-10-25T09:30:00.000Z'] });

// "applied,interview" -> ['applied', 'interview'], each checked against the allowed values.
export function csvListSchema<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)).min(1))
    .meta({ description: `Comma-separated: ${values.join(', ')}` });
}

// Optional text field that may also be cleared by sending null.
export function optionalText(max: number) {
  return z.string().trim().max(max).nullable().optional();
}
