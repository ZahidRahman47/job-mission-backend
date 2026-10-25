// GET /analytics/summary, /timeseries, /sources, /upcoming.
import { Router } from 'express';
import { userRateLimit } from '../../middleware/rate-limit.ts';
import { requireAuth } from '../../middleware/require-auth.ts';
import * as analytics from './analytics.controller.ts';

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth, userRateLimit);
analyticsRouter.get('/summary', analytics.summary);
analyticsRouter.get('/timeseries', analytics.timeseries);
analyticsRouter.get('/sources', analytics.sources);
analyticsRouter.get('/upcoming', analytics.upcoming);
