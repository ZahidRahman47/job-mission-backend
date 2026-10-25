// CRUD /applications plus status, archive/restore, timeline, notes, interviews, contacts.
import { Router } from 'express';
import { userRateLimit } from '../../middleware/rate-limit.ts';
import { requireAuth } from '../../middleware/require-auth.ts';
import * as applications from './applications.controller.ts';

export const applicationsRouter = Router();

applicationsRouter.use(requireAuth, userRateLimit);

applicationsRouter.get('/', applications.list);
applicationsRouter.post('/', applications.create);
applicationsRouter.get('/:id', applications.get);
applicationsRouter.patch('/:id', applications.update);
applicationsRouter.delete('/:id', applications.remove);

// A status change is a state transition with rules, not a plain field edit, so it has its own route.
applicationsRouter.post('/:id/status', applications.changeStatus);
applicationsRouter.post('/:id/archive', applications.archive);
applicationsRouter.post('/:id/restore', applications.restore);

applicationsRouter.get('/:id/activities', applications.listTimeline);
applicationsRouter.post('/:id/notes', applications.addNote);
applicationsRouter.patch('/:id/notes/:noteId', applications.updateNote);
applicationsRouter.delete('/:id/notes/:noteId', applications.deleteNote);

applicationsRouter.post('/:id/interviews', applications.addInterview);
applicationsRouter.patch('/:id/interviews/:interviewId', applications.updateInterview);
applicationsRouter.delete('/:id/interviews/:interviewId', applications.removeInterview);

applicationsRouter.put('/:id/contacts', applications.setContacts);
