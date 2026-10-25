// CSV template download, CSV upload, import report.
import express, { Router } from 'express';
import { importLimiter, userRateLimit } from '../../middleware/rate-limit.ts';
import { requireAuth } from '../../middleware/require-auth.ts';
import * as imports from './imports.controller.ts';

export const importsRouter = Router();

// 5 MB cap is enforced while reading the body: a bigger upload is rejected with 413 before parsing.
const csvBody = express.text({ type: ['text/csv', 'application/csv', 'text/plain'], limit: '5mb' });

importsRouter.use(requireAuth);
importsRouter.get('/applications/template', userRateLimit, imports.template);
importsRouter.post('/applications', importLimiter, csvBody, imports.importApplications);
importsRouter.get('/:id', userRateLimit, imports.getReport);
