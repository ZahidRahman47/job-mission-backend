// Shared building blocks for the OpenAPI (Swagger) docs: the error envelope, common error responses
// and security requirements. Each module documents its own paths with these (NFR-034).
import { z } from 'zod';
import type { ZodOpenApiOperationObject, ZodOpenApiResponseObject } from 'zod-openapi';

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().meta({ examples: ['VALIDATION_ERROR'] }),
      message: z.string().meta({ examples: ['The request contains invalid fields.'] }),
      details: z.unknown().optional(),
      requestId: z.string().meta({ examples: ['0b9f3a52-6a0e-4c43-9a8e-2f5b8b7c1d10'] }),
    }),
  })
  .meta({ id: 'ErrorResponse' });

export function jsonContent(schema: z.ZodType): NonNullable<ZodOpenApiResponseObject['content']> {
  return { 'application/json': { schema } };
}

function errorResponse(description: string): ZodOpenApiResponseObject {
  return { description, content: jsonContent(errorResponseSchema) };
}

// A success response with a JSON body.
export function ok(description: string, schema: z.ZodType): ZodOpenApiResponseObject {
  return { description, content: jsonContent(schema) };
}

export const errors = {
  conflict: errorResponse('`CONFLICT` or a more specific 409 code: see the message and details.'),
  validation: errorResponse('`VALIDATION_ERROR`: invalid or unknown fields.'),
  unauthenticated: errorResponse('`UNAUTHENTICATED` or `SESSION_EXPIRED`: log in first.'),
  invalidCredentials: errorResponse('`INVALID_CREDENTIALS`: wrong email or password.'),
  tokenInvalid: errorResponse('`TOKEN_INVALID`: the link is unknown, used or expired.'),
  csrf: errorResponse('`CSRF_REJECTED`: missing `X-Requested-With` header or foreign origin.'),
  notFound: errorResponse('`NOT_FOUND`: does not exist or is not yours.'),
  rateLimited: errorResponse('`RATE_LIMITED`: too many attempts; see the `Retry-After` header.'),
} satisfies Record<string, ZodOpenApiResponseObject>;

// Security requirements, matching the schemes declared in src/openapi.ts.
export const security = {
  // Public endpoint that changes state: only the CSRF header.
  publicWrite: [{ csrfHeader: [] }],
  // Logged-in read.
  sessionRead: [{ sessionCookie: [] }],
  // Logged-in write: session cookie and CSRF header.
  sessionWrite: [{ sessionCookie: [], csrfHeader: [] }],
} satisfies Record<string, ZodOpenApiOperationObject['security']>;
