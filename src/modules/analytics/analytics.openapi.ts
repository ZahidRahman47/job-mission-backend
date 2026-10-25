// Swagger documentation for /analytics and the /activities feed.
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { errors, ok, security } from '../../lib/openapi.ts';
import { activityListResponseSchema, feedQuery } from '../activities/activities.schemas.ts';
import {
  rangeQuery,
  sourcesSchema,
  summarySchema,
  timeseriesQuery,
  timeseriesSchema,
  upcomingSchema,
} from './analytics.schemas.ts';

const tags = ['Dashboard'];
const wrap = (schema: z.ZodType) => z.object({ data: schema });

export const analyticsPaths: ZodOpenApiPathsObject = {
  '/analytics/summary': {
    get: {
      tags,
      summary: 'Headline metrics for a date range',
      description:
        'Cohort = applications with an applied date in the range (your timezone), archived included. Rates are `null` when there is nothing to divide by.',
      security: security.sessionRead,
      requestParams: { query: rangeQuery },
      responses: {
        '200': ok('Metrics.', wrap(summarySchema)),
        '400': errors.validation,
        '401': errors.unauthenticated,
      },
    },
  },
  '/analytics/timeseries': {
    get: {
      tags,
      summary: 'Applications per week or month (empty periods included as 0)',
      security: security.sessionRead,
      requestParams: { query: timeseriesQuery },
      responses: {
        '200': ok('Buckets.', wrap(timeseriesSchema)),
        '400': errors.validation,
        '401': errors.unauthenticated,
      },
    },
  },
  '/analytics/sources': {
    get: {
      tags,
      summary: 'Which sources get responses and interviews',
      security: security.sessionRead,
      requestParams: { query: rangeQuery },
      responses: {
        '200': ok('Per-source stats.', wrap(sourcesSchema)),
        '400': errors.validation,
        '401': errors.unauthenticated,
      },
    },
  },
  '/analytics/upcoming': {
    get: {
      tags,
      summary: "What needs me now: overdue and today's reminders, interviews in the next 7 days",
      security: security.sessionRead,
      responses: {
        '200': ok('Upcoming actions.', wrap(upcomingSchema)),
        '401': errors.unauthenticated,
      },
    },
  },
  '/activities': {
    get: {
      tags,
      summary: 'Recent activity across all applications (cursor pagination)',
      security: security.sessionRead,
      requestParams: { query: feedQuery },
      responses: {
        '200': ok('A page of activity.', activityListResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
      },
    },
  },
};
