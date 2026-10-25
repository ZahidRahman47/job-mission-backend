// HTTP <-> activities service.
import type { Request, Response } from 'express';
import { parseInput } from '../../lib/validation.ts';
import { getAuth } from '../../middleware/require-auth.ts';
import { feedQuery } from './activities.schemas.ts';
import * as activitiesService from './activities.service.ts';

export async function listFeed(req: Request, res: Response): Promise<void> {
  const { cursor, limit } = parseInput(feedQuery, req.query, 'query');
  res.status(200).json(await activitiesService.listFeed(getAuth(req).userId, cursor, limit));
}
