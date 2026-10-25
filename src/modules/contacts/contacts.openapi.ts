// Swagger documentation for /contacts.
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { errors, jsonContent, ok, security } from '../../lib/openapi.ts';
import { idParams } from '../../lib/schemas.ts';
import {
  activityListResponseSchema,
  activityResponseSchema,
} from '../activities/activities.schemas.ts';
import {
  contactListResponseSchema,
  contactResponseSchema,
  createContactBody,
  interactionBody,
  interactionsQuery,
  listContactsQuery,
  updateContactBody,
} from './contacts.schemas.ts';

const tags = ['Contacts'];

export const contactsPaths: ZodOpenApiPathsObject = {
  '/contacts': {
    get: {
      tags,
      summary: 'List my contacts',
      security: security.sessionRead,
      requestParams: { query: listContactsQuery },
      responses: {
        '200': ok('A page of contacts.', contactListResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
      },
    },
    post: {
      tags,
      summary: 'Create a contact',
      security: security.sessionWrite,
      requestBody: { content: jsonContent(createContactBody) },
      responses: {
        '201': ok('Created.', contactResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
  },
  '/contacts/{id}': {
    get: {
      tags,
      summary: 'Get a contact',
      security: security.sessionRead,
      requestParams: { path: idParams },
      responses: {
        '200': ok('The contact.', contactResponseSchema),
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
    patch: {
      tags,
      summary: 'Update a contact',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      requestBody: { content: jsonContent(updateContactBody) },
      responses: {
        '200': ok('Updated.', contactResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
    delete: {
      tags,
      summary: 'Delete a contact',
      description: 'Unlinks it from applications; its interaction history is kept.',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      responses: {
        '204': { description: 'Deleted.' },
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
  },
  '/contacts/{id}/interactions': {
    get: {
      tags,
      summary: 'Interaction history with this contact (newest first)',
      security: security.sessionRead,
      requestParams: { path: idParams, query: interactionsQuery },
      responses: {
        '200': ok('A page of interactions.', activityListResponseSchema),
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
    post: {
      tags,
      summary: 'Log an interaction (email, call, meeting...)',
      description: "If `applicationId` is given, it also appears on that application's timeline.",
      security: security.sessionWrite,
      requestParams: { path: idParams },
      requestBody: { content: jsonContent(interactionBody) },
      responses: {
        '201': ok('Logged.', activityResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
  },
};
