// GET /health/live and GET /health/ready. Public, and not rate-limited so monitors are never throttled.
import { Router } from 'express';
import { live, ready } from './health.controller.ts';

export const healthRouter = Router();

healthRouter.get('/live', live);
healthRouter.get('/ready', ready);
