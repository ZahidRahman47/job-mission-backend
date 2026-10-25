// GET /health/live and GET /health/ready. Public, and not rate-limited so monitors are never throttled.
import { Router } from 'express';
import { live, ready } from './health.controller.ts';

export const healthRouter = Router();

healthRouter.get('/live', live);
healthRouter.get('/ready', ready);

// TEMPORARY (2026-10-25): shows the caller which IP rate limits see for them, to set
// TRUST_PROXY_HOPS correctly behind Vercel. Only ever echoes the caller's own address. Remove after.
healthRouter.get('/client-ip', (req, res) => {
  res.status(200).json({
    ip: req.ip,
    forwardedFor: req.get('x-forwarded-for') ?? null,
    realIp: req.get('x-real-ip') ?? null,
    vercelForwardedFor: req.get('x-vercel-forwarded-for') ?? null,
    trustProxy: req.app.get('trust proxy') as unknown,
  });
});
