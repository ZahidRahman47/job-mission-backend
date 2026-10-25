// Swagger documentation for the health checks.
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { jsonContent } from '../../lib/openapi.ts';

const readinessSchema = z
  .object({
    status: z.enum(['ok', 'unavailable', 'shutting_down']),
    checks: z.object({ database: z.enum(['ok', 'down']) }).optional(),
  })
  .meta({ id: 'Readiness' });

export const healthPaths: ZodOpenApiPathsObject = {
  '/health/live': {
    get: {
      tags: ['Health'],
      summary: 'Liveness: is the process running?',
      security: [],
      responses: {
        '200': {
          description: 'Alive.',
          content: jsonContent(z.object({ status: z.literal('ok') })),
        },
      },
    },
  },
  '/health/ready': {
    get: {
      tags: ['Health'],
      summary: 'Readiness: can this instance serve traffic?',
      description:
        'Pings MongoDB (1 s timeout). Returns 503 while the database is down or the server is shutting down.',
      security: [],
      responses: {
        '200': { description: 'Ready.', content: jsonContent(readinessSchema) },
        '503': { description: 'Not ready.', content: jsonContent(readinessSchema) },
      },
    },
  },
};
