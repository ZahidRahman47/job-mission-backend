// HTTP <-> capture service. Token management uses the session; ingest uses the capture token.
import type { Request, Response } from 'express';
import { parseInput } from '../../lib/validation.ts';
import { getAuth } from '../../middleware/require-auth.ts';
import { ingestGmailBody } from './capture.schemas.ts';
import * as captureService from './capture.service.ts';

export async function getToken(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await captureService.getTokenStatus(getAuth(req).userId) });
}

export async function createToken(req: Request, res: Response): Promise<void> {
  res.status(201).json({ data: await captureService.createToken(getAuth(req).userId) });
}

export async function revokeToken(req: Request, res: Response): Promise<void> {
  await captureService.revokeToken(getAuth(req).userId);
  res.status(204).end();
}

// `Authorization: Bearer <capture token>`, sent by the Gmail script.
export async function ingestGmail(req: Request, res: Response): Promise<void> {
  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  const userId = await captureService.authenticate(token);
  const body = parseInput(ingestGmailBody, req.body, 'body');
  const result = await captureService.ingestGmail(userId, body);
  // Rules only for now, so this is fast enough to finish before answering the script.
  await captureService.processPending(userId);
  res.status(200).json({ data: result });
}
