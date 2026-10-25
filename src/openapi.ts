// Assembles the OpenAPI document from every module's paths. Served as JSON at /api/v1/openapi.json
// and as Swagger UI at /api/v1/docs (non-production only).
import { createDocument, type ZodOpenApiPathsObject } from 'zod-openapi';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from './middleware/csrf-guard.ts';
import { analyticsPaths } from './modules/analytics/analytics.openapi.ts';
import { applicationsPaths } from './modules/applications/applications.openapi.ts';
import { accountPaths, authPaths } from './modules/auth/auth.openapi.ts';
import { SESSION_COOKIE } from './modules/auth/session-cookie.ts';
import { companiesPaths } from './modules/companies/companies.openapi.ts';
import { contactsPaths } from './modules/contacts/contacts.openapi.ts';
import { healthPaths } from './modules/health/health.openapi.ts';
import { importExportPaths } from './modules/imports/imports.openapi.ts';
import { remindersPaths } from './modules/reminders/reminders.openapi.ts';
import { usersPaths } from './modules/users/users.openapi.ts';

export const openApiDocument = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'Mission Control API',
    version: '1.0.0',
    description: [
      'Job-search command center API.',
      '',
      '**Trying it here:** click **Authorize** and enter `' +
        CSRF_HEADER_VALUE +
        '` for `csrfHeader` (needed on every POST/PATCH/PUT/DELETE). Then call `POST /auth/login`: the browser stores the session cookie and sends it on the following calls.',
    ].join('\n'),
  },
  servers: [{ url: '/api/v1' }],
  security: [],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: SESSION_COOKIE,
        description: 'Set automatically by `POST /auth/login`.',
      },
      csrfHeader: {
        type: 'apiKey',
        in: 'header',
        name: CSRF_HEADER,
        description: `Send \`${CSRF_HEADER_VALUE}\` on every state-changing request.`,
      },
    },
  },
  // Merged; a path defined by two modules (e.g. /users/me GET and DELETE) combines its methods.
  paths: mergePaths(
    healthPaths,
    authPaths,
    usersPaths,
    accountPaths,
    analyticsPaths,
    applicationsPaths,
    remindersPaths,
    companiesPaths,
    contactsPaths,
    importExportPaths,
  ),
});

function mergePaths(...groups: ZodOpenApiPathsObject[]): ZodOpenApiPathsObject {
  const merged: ZodOpenApiPathsObject = {};
  for (const group of groups) {
    for (const [path, operations] of Object.entries(group)) {
      merged[path] = { ...merged[path], ...operations };
    }
  }
  return merged;
}
