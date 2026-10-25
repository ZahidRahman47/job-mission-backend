// Mounts every module router under /api/v1.
import { Router } from 'express';
import { activitiesRouter } from './modules/activities/activities.routes.ts';
import { analyticsRouter } from './modules/analytics/analytics.routes.ts';
import { applicationsRouter } from './modules/applications/applications.routes.ts';
import { captureRouter } from './modules/capture/capture.routes.ts';
import { accountRouter, authRouter } from './modules/auth/auth.routes.ts';
import { companiesRouter } from './modules/companies/companies.routes.ts';
import { contactsRouter } from './modules/contacts/contacts.routes.ts';
import { exportsRouter } from './modules/exports/exports.routes.ts';
import { healthRouter } from './modules/health/health.routes.ts';
import { importsRouter } from './modules/imports/imports.routes.ts';
import { remindersRouter } from './modules/reminders/reminders.routes.ts';
import { usersRouter } from './modules/users/users.routes.ts';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/users/me', accountRouter);
apiRouter.use('/companies', companiesRouter);
apiRouter.use('/contacts', contactsRouter);
apiRouter.use('/applications', applicationsRouter);
apiRouter.use('/activities', activitiesRouter);
apiRouter.use('/reminders', remindersRouter);
apiRouter.use('/capture', captureRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/imports', importsRouter);
apiRouter.use('/exports', exportsRouter);
