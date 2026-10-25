// Swagger documentation for the users module.
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { errors, jsonContent, security } from '../../lib/openapi.ts';
import {
  notificationsSchema,
  preferencesSchema,
  updateProfileBody,
  userResponseSchema,
} from './users.schemas.ts';

const tags = ['Account'];
const userUpdated = { description: 'The updated user.', content: jsonContent(userResponseSchema) };

export const usersPaths: ZodOpenApiPathsObject = {
  '/users/me': {
    get: {
      tags,
      summary: 'Get the logged-in user',
      description: 'The frontend\'s single source of truth for "am I logged in?" (FR-010).',
      security: security.sessionRead,
      responses: {
        '200': { description: 'The current user.', content: jsonContent(userResponseSchema) },
        '401': errors.unauthenticated,
      },
    },
    patch: {
      tags,
      summary: 'Update name or timezone',
      security: security.sessionWrite,
      requestBody: { content: jsonContent(updateProfileBody) },
      responses: { '200': userUpdated, '400': errors.validation, '401': errors.unauthenticated },
    },
  },
  '/users/me/preferences': {
    put: {
      tags,
      summary: 'Replace job-search preferences',
      security: security.sessionWrite,
      requestBody: { content: jsonContent(preferencesSchema) },
      responses: { '200': userUpdated, '400': errors.validation, '401': errors.unauthenticated },
    },
  },
  '/users/me/notifications': {
    put: {
      tags,
      summary: 'Replace notification settings',
      security: security.sessionWrite,
      requestBody: { content: jsonContent(notificationsSchema) },
      responses: { '200': userUpdated, '400': errors.validation, '401': errors.unauthenticated },
    },
  },
};
