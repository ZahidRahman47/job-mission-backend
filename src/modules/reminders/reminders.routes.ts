// CRUD /reminders plus complete/reopen.
import { Router } from 'express';
import { userRateLimit } from '../../middleware/rate-limit.ts';
import { requireAuth } from '../../middleware/require-auth.ts';
import * as reminders from './reminders.controller.ts';

export const remindersRouter = Router();

remindersRouter.use(requireAuth, userRateLimit);
remindersRouter.get('/', reminders.list);
remindersRouter.post('/', reminders.create);
remindersRouter.get('/:id', reminders.get);
remindersRouter.patch('/:id', reminders.update);
remindersRouter.post('/:id/complete', reminders.complete);
remindersRouter.post('/:id/reopen', reminders.reopen);
remindersRouter.delete('/:id', reminders.remove);
