// Swagger documentation for /imports and /exports.
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { errors, ok, security } from '../../lib/openapi.ts';
import { idParams } from '../../lib/schemas.ts';
import { exportApplicationsQuery } from '../applications/applications.schemas.ts';
import { importQuery, importReportResponseSchema } from './imports.schemas.ts';

const csvFile = { 'text/csv': { schema: z.string().meta({ format: 'binary' }) } };

export const importExportPaths: ZodOpenApiPathsObject = {
  '/imports/applications/template': {
    get: {
      tags: ['Import & export'],
      summary: 'Download the CSV import template',
      security: security.sessionRead,
      responses: {
        '200': { description: 'CSV file.', content: csvFile },
        '401': errors.unauthenticated,
      },
    },
  },
  '/imports/applications': {
    post: {
      tags: ['Import & export'],
      summary: 'Import applications from CSV',
      description:
        'Send the file as the raw body with `Content-Type: text/csv` (max 5 MB, 5,000 rows). Valid rows are created; invalid rows are reported by row number; duplicates (same company, title and applied date) are skipped. 10 imports per hour.',
      security: security.sessionWrite,
      requestParams: { query: importQuery },
      requestBody: { content: csvFile },
      responses: {
        '201': ok('The import report.', importReportResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
        '413': { description: '`PAYLOAD_TOO_LARGE`: over 5 MB.' },
        '415': { description: '`UNSUPPORTED_MEDIA_TYPE`: not sent as text/csv.' },
        '429': errors.rateLimited,
      },
    },
  },
  '/imports/{id}': {
    get: {
      tags: ['Import & export'],
      summary: 'Get an import report (kept 30 days)',
      security: security.sessionRead,
      requestParams: { path: idParams },
      responses: {
        '200': ok('The report.', importReportResponseSchema),
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
  },
  '/exports/applications.csv': {
    get: {
      tags: ['Import & export'],
      summary: 'Export applications as CSV (same filters as the list)',
      description:
        'Cells that a spreadsheet would run as formulas (starting with = + - @) are escaped. 20 exports per hour.',
      security: security.sessionRead,
      requestParams: { query: exportApplicationsQuery },
      responses: {
        '200': { description: 'CSV file.', content: csvFile },
        '401': errors.unauthenticated,
        '429': errors.rateLimited,
      },
    },
  },
  '/exports/account.json': {
    get: {
      tags: ['Import & export'],
      summary: 'Download all my data as JSON',
      security: security.sessionRead,
      responses: {
        '200': { description: 'JSON file with every record you own.' },
        '401': errors.unauthenticated,
        '429': errors.rateLimited,
      },
    },
  },
};
