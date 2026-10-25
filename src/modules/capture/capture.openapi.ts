// Swagger documentation for /capture (token management) and /inbound/gmail (the Gmail script).
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { errors, ok, security } from '../../lib/openapi.ts';
import {
  captureTokenStatusSchema,
  createdCaptureTokenSchema,
  ingestGmailBody,
  ingestResultSchema,
} from './capture.schemas.ts';

export const capturePaths: ZodOpenApiPathsObject = {
  '/capture/token': {
    get: {
      tags: ['Email capture'],
      summary: 'Whether a Gmail capture token exists, and when it was last used',
      security: security.sessionRead,
      responses: {
        '200': ok('Token status (never the token itself).', captureTokenStatusSchema),
        '401': errors.unauthenticated,
      },
    },
    post: {
      tags: ['Email capture'],
      summary: 'Create a capture token (replaces the previous one)',
      description: 'The token is returned once. The previous token stops working immediately.',
      security: security.sessionWrite,
      responses: {
        '201': ok('The new token.', createdCaptureTokenSchema),
        '401': errors.unauthenticated,
        '403': errors.csrf,
      },
    },
    delete: {
      tags: ['Email capture'],
      summary: 'Revoke the capture token',
      security: security.sessionWrite,
      responses: {
        '204': { description: 'Revoked (or there was none).' },
        '401': errors.unauthenticated,
        '403': errors.csrf,
      },
    },
  },
  '/inbound/gmail': {
    post: {
      tags: ['Email capture'],
      summary: 'Store emails sent by the Gmail capture script',
      description:
        'Auth: `Authorization: Bearer <capture token>` (no cookie, no CSRF header). Up to 20 emails per call, 2 MB body. Emails already stored (same `gmailId`) are ignored, so the script can safely resend. 120 calls per hour per token.',
      requestBody: { content: { 'application/json': { schema: ingestGmailBody } } },
      responses: {
        '200': ok('How many emails were new.', ingestResultSchema),
        '400': errors.validation,
        '401': { description: '`CAPTURE_TOKEN_INVALID`: missing, unknown or revoked token.' },
        '413': { description: '`PAYLOAD_TOO_LARGE`: over 2 MB.' },
        '429': errors.rateLimited,
      },
    },
  },
};
