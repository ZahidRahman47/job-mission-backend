// CRUD /contacts and contact interactions.
import { Router } from 'express';
import { userRateLimit } from '../../middleware/rate-limit.ts';
import { requireAuth } from '../../middleware/require-auth.ts';
import * as contacts from './contacts.controller.ts';

export const contactsRouter = Router();

contactsRouter.use(requireAuth, userRateLimit);
contactsRouter.get('/', contacts.list);
contactsRouter.post('/', contacts.create);
contactsRouter.get('/:id', contacts.get);
contactsRouter.patch('/:id', contacts.update);
contactsRouter.delete('/:id', contacts.remove);
contactsRouter.get('/:id/interactions', contacts.listInteractions);
contactsRouter.post('/:id/interactions', contacts.addInteraction);
