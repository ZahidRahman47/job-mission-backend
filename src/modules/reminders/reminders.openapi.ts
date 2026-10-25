// Swagger documentation for /reminders.
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { errors, jsonContent, ok, security } from '../../lib/openapi.ts';
import { idParams } from '../../lib/schemas.ts';
import {
  createReminderBody,
  listRemindersQuery,
  reminderListResponseSchema,
  reminderResponseSchema,
  updateReminderBody,
} from './reminders.schemas.ts';

const tags = ['Reminders'];
const reminder = ok('The reminder.', reminderResponseSchema);

export const remindersPaths: ZodOpenApiPathsObject = {
  '/reminders': {
    get: {
      tags,
      summary: 'List reminders by view: overdue, today, upcoming or completed',
      security: security.sessionRead,
      requestParams: { query: listRemindersQuery },
      responses: {
        '200': ok('A page of reminders.', reminderListResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
      },
    },
    post: {
      tags,
      summary: 'Create a reminder',
      description:
        'A second pending reminder for the same application at the same minute returns 409 `DUPLICATE_REMINDER`. Linked applications get their `nextFollowUpAt` updated.',
      security: security.sessionWrite,
      requestBody: { content: jsonContent(createReminderBody) },
      responses: {
        '201': reminder,
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
        '409': errors.conflict,
      },
    },
  },
  '/reminders/{id}': {
    get: {
      tags,
      summary: 'Get a reminder',
      security: security.sessionRead,
      requestParams: { path: idParams },
      responses: { '200': reminder, '401': errors.unauthenticated, '404': errors.notFound },
    },
    patch: {
      tags,
      summary: 'Edit, reschedule or re-link a reminder',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      requestBody: { content: jsonContent(updateReminderBody) },
      responses: {
        '200': reminder,
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
        '409': errors.conflict,
      },
    },
    delete: {
      tags,
      summary: 'Delete a reminder',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      responses: {
        '204': { description: 'Deleted.' },
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
  },
  '/reminders/{id}/complete': {
    post: {
      tags,
      summary: 'Mark done (idempotent)',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      responses: { '200': reminder, '401': errors.unauthenticated, '404': errors.notFound },
    },
  },
  '/reminders/{id}/reopen': {
    post: {
      tags,
      summary: 'Mark not done again (idempotent)',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      responses: {
        '200': reminder,
        '401': errors.unauthenticated,
        '404': errors.notFound,
        '409': errors.conflict,
      },
    },
  },
};
