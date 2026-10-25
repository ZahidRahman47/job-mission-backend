// HTTP <-> analytics service.
import type { Request, Response } from 'express';
import { parseInput } from '../../lib/validation.ts';
import { getAuth } from '../../middleware/require-auth.ts';
import { rangeQuery, timeseriesQuery } from './analytics.schemas.ts';
import * as analyticsService from './analytics.service.ts';

export async function summary(req: Request, res: Response): Promise<void> {
  const { from, to } = parseInput(rangeQuery, req.query, 'query');
  res.status(200).json({ data: await analyticsService.summary(getAuth(req).userId, from, to) });
}

export async function timeseries(req: Request, res: Response): Promise<void> {
  const { from, to, interval } = parseInput(timeseriesQuery, req.query, 'query');
  res
    .status(200)
    .json({ data: await analyticsService.timeseries(getAuth(req).userId, interval, from, to) });
}

export async function sources(req: Request, res: Response): Promise<void> {
  const { from, to } = parseInput(rangeQuery, req.query, 'query');
  res.status(200).json({ data: await analyticsService.sources(getAuth(req).userId, from, to) });
}

export async function upcoming(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await analyticsService.upcoming(getAuth(req).userId) });
}
