// Capture token management (/capture, session) and the Gmail ingest endpoint (/inbound, token).
import express, { Router } from 'express';
import { captureIngestLimiter, userRateLimit } from '../../middleware/rate-limit.ts';
import { requireAuth } from '../../middleware/require-auth.ts';
import * as capture from './capture.controller.ts';

export const captureRouter = Router();

captureRouter.use(requireAuth, userRateLimit);
captureRouter.get('/token', capture.getToken);
captureRouter.post('/token', capture.createToken);
captureRouter.delete('/token', capture.revokeToken);

// Mounted in app.ts before the global 100 KB JSON parser and the CSRF guard: the caller is a
// script with a bearer token, not a browser with a cookie, so there is no CSRF to guard against.
export const inboundRouter = Router();

inboundRouter.post(
  '/gmail',
  captureIngestLimiter,
  express.json({ limit: '2mb' }),
  capture.ingestGmail,
);
