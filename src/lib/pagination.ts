// Page-based and cursor-based pagination helpers with a stable _id tiebreak (BR-030 to BR-033).
import { z } from 'zod';
import { ValidationError } from './errors.ts';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

export const pageMetaSchema = z
  .object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({ id: 'PageMeta' });

export const cursorMetaSchema = z
  .object({ nextCursor: z.string().nullable() })
  .meta({ id: 'CursorMeta' });

// A cursor marks "the last item you saw": its timestamp plus _id to break ties. Opaque to clients.
export interface Cursor {
  at: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.at.toISOString(), cursor.id])).toString('base64url');
}

export function decodeCursor(value: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      /^[a-f0-9]{24}$/i.test(parsed[1])
    ) {
      const at = new Date(parsed[0]);
      if (!Number.isNaN(at.getTime())) return { at, id: parsed[1] };
    }
  } catch {
    // fall through to the validation error
  }
  throw new ValidationError([{ location: 'query', path: ['cursor'], message: 'Invalid cursor.' }]);
}
