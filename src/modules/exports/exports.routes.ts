// GET /exports/applications.csv and /exports/account.json.
import { Router } from 'express';
import { exportLimiter } from '../../middleware/rate-limit.ts';
import { requireAuth } from '../../middleware/require-auth.ts';
import * as exportsController from './exports.controller.ts';

export const exportsRouter = Router();

exportsRouter.use(requireAuth, exportLimiter);
exportsRouter.get('/applications.csv', exportsController.applicationsCsv);
exportsRouter.get('/account.json', exportsController.accountJson);
