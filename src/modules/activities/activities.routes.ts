// GET /activities: the global activity feed (cursor pagination).
import { Router } from 'express';
import { userRateLimit } from '../../middleware/rate-limit.ts';
import { requireAuth } from '../../middleware/require-auth.ts';
import * as activities from './activities.controller.ts';

export const activitiesRouter = Router();

activitiesRouter.get('/', requireAuth, userRateLimit, activities.listFeed);
