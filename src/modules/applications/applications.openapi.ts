// Swagger documentation for /applications.
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { errors, jsonContent, ok, security } from '../../lib/openapi.ts';
import { idParams } from '../../lib/schemas.ts';
import {
  activityListResponseSchema,
  activityResponseSchema,
  noteBody,
  noteUpdateBody,
} from '../activities/activities.schemas.ts';
import {
  applicationDetailResponseSchema,
  applicationListResponseSchema,
  applicationResponseSchema,
  createApplicationBody,
  interviewBody,
  interviewParams,
  interviewUpdateBody,
  listApplicationsQuery,
  noteParams,
  setContactsBody,
  statusChangeBody,
  timelineQuery,
  updateApplicationBody,
} from './applications.schemas.ts';

const tags = ['Applications'];
const updated = ok('The updated application.', applicationResponseSchema);

export const applicationsPaths: ZodOpenApiPathsObject = {
  '/applications': {
    get: {
      tags,
      summary: 'List, search, filter, sort and paginate my applications',
      description:
        'Archived applications are excluded unless `archived=only|include`. Lists omit `jobDescription` and `interviews` (see `interviewCount`). Empty values sort last.',
      security: security.sessionRead,
      requestParams: { query: listApplicationsQuery },
      responses: {
        '200': ok('A page of applications.', applicationListResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
      },
    },
    post: {
      tags,
      summary: 'Create an application',
      description:
        'Give `companyId` or `companyName` (reused if it exists). Anything past `saved` gets an applied date (default: now). Creating directly at a later status sets the implied milestones.',
      security: security.sessionWrite,
      requestBody: { content: jsonContent(createApplicationBody) },
      responses: {
        '201': ok('Created.', applicationResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
  },
  '/applications/{id}': {
    get: {
      tags,
      summary: 'Get an application with its contacts and pending reminders',
      security: security.sessionRead,
      requestParams: { path: idParams },
      responses: {
        '200': ok('The application.', applicationDetailResponseSchema),
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
    patch: {
      tags,
      summary: 'Edit fields (not status)',
      description:
        'Send the `version` you read. If someone changed it since, you get 409 `CONFLICT`: reload and retry.',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      requestBody: { content: jsonContent(updateApplicationBody) },
      responses: {
        '200': updated,
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
        '409': errors.conflict,
      },
    },
    delete: {
      tags,
      summary: 'Delete permanently (with its timeline and reminders)',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      responses: {
        '204': { description: 'Deleted.' },
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
  },
  '/applications/{id}/status': {
    post: {
      tags,
      summary: 'Change status',
      description:
        'Allowed: saved→applied|withdrawn; applied→screening|interview|offer|rejected|withdrawn; screening→interview|offer|rejected|withdrawn; interview→offer|rejected|withdrawn; offer→accepted|rejected|withdrawn; rejected/withdrawn→back to the previous status. Anything else: 409 `INVALID_STATUS_TRANSITION` with `details.allowed`.',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      requestBody: { content: jsonContent(statusChangeBody) },
      responses: {
        '200': updated,
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
        '409': errors.conflict,
      },
    },
  },
  '/applications/{id}/archive': {
    post: {
      tags,
      summary: 'Archive (hide from lists, still counted in analytics)',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      responses: { '200': updated, '401': errors.unauthenticated, '404': errors.notFound },
    },
  },
  '/applications/{id}/restore': {
    post: {
      tags,
      summary: 'Restore from the archive',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      responses: { '200': updated, '401': errors.unauthenticated, '404': errors.notFound },
    },
  },
  '/applications/{id}/activities': {
    get: {
      tags,
      summary: 'Timeline (newest first, cursor pagination)',
      security: security.sessionRead,
      requestParams: { path: idParams, query: timelineQuery },
      responses: {
        '200': ok('A page of timeline events.', activityListResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
  },
  '/applications/{id}/notes': {
    post: {
      tags,
      summary: 'Add a note',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      requestBody: { content: jsonContent(noteBody) },
      responses: {
        '201': ok('The note.', activityResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
  },
  '/applications/{id}/notes/{noteId}': {
    patch: {
      tags,
      summary: 'Edit a note',
      security: security.sessionWrite,
      requestParams: { path: noteParams },
      requestBody: { content: jsonContent(noteUpdateBody) },
      responses: {
        '200': ok('The note.', activityResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
    delete: {
      tags,
      summary: 'Delete a note',
      security: security.sessionWrite,
      requestParams: { path: noteParams },
      responses: {
        '204': { description: 'Deleted.' },
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
  },
  '/applications/{id}/interviews': {
    post: {
      tags,
      summary: 'Add an interview round (max 20)',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      requestBody: { content: jsonContent(interviewBody) },
      responses: {
        '201': updated,
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
        '409': errors.conflict,
      },
    },
  },
  '/applications/{id}/interviews/{interviewId}': {
    patch: {
      tags,
      summary: 'Update an interview round (e.g. record the outcome)',
      security: security.sessionWrite,
      requestParams: { path: interviewParams },
      requestBody: { content: jsonContent(interviewUpdateBody) },
      responses: {
        '200': updated,
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
    delete: {
      tags,
      summary: 'Remove an interview round',
      security: security.sessionWrite,
      requestParams: { path: interviewParams },
      responses: { '200': updated, '401': errors.unauthenticated, '404': errors.notFound },
    },
  },
  '/applications/{id}/contacts': {
    put: {
      tags,
      summary: 'Replace the linked contacts (max 10, must be yours)',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      requestBody: { content: jsonContent(setContactsBody) },
      responses: {
        '200': updated,
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
  },
};
