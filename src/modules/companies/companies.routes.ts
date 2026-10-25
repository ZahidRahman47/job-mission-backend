// CRUD /companies.
import { Router } from 'express';
import { userRateLimit } from '../../middleware/rate-limit.ts';
import { requireAuth } from '../../middleware/require-auth.ts';
import * as companies from './companies.controller.ts';

export const companiesRouter = Router();

companiesRouter.use(requireAuth, userRateLimit);
companiesRouter.get('/', companies.list);
companiesRouter.post('/', companies.create);
companiesRouter.get('/:id', companies.get);
companiesRouter.patch('/:id', companies.update);
companiesRouter.delete('/:id', companies.remove);
