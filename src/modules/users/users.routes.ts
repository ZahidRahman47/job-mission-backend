// /users/me profile routes. Sessions and account deletion live in auth.routes.ts (accountRouter).
import { Router } from 'express';
import { userRateLimit } from '../../middleware/rate-limit.ts';
import { requireAuth } from '../../middleware/require-auth.ts';
import * as users from './users.controller.ts';

export const usersRouter = Router();

const authed = [requireAuth, userRateLimit];

usersRouter.get('/me', ...authed, users.getMe);
usersRouter.patch('/me', ...authed, users.updateMe);
usersRouter.put('/me/preferences', ...authed, users.setPreferences);
usersRouter.put('/me/notifications', ...authed, users.setNotifications);
