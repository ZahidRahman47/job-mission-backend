// Validates untrusted request input (body, query, params) against a Zod schema at the boundary.
// Controllers call this first; services only ever receive parsed, typed data (NFR-010).
import type { z } from 'zod';
import { ValidationError, type ValidationIssue } from './errors.ts';

export function parseInput<S extends z.ZodType>(
  schema: S,
  data: unknown,
  location: ValidationIssue['location'],
): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((issue) => ({
        location,
        path: issue.path.map(String),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

// User text used inside a MongoDB $regex must be escaped, or "a.*" would match everything and
// a crafted pattern could make the database do exponential work (ReDoS, threat T10).
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
