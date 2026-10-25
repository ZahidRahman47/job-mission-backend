// HTTP <-> exports service (file downloads).
import type { Request, Response } from 'express';
import { parseInput } from '../../lib/validation.ts';
import { getAuth } from '../../middleware/require-auth.ts';
import { exportApplicationsQuery } from '../applications/applications.schemas.ts';
import * as exportsService from './exports.service.ts';

const today = (): string => new Date().toISOString().slice(0, 10);

export async function applicationsCsv(req: Request, res: Response): Promise<void> {
  const query = parseInput(exportApplicationsQuery, req.query, 'query');
  const csv = await exportsService.applicationsCsv(getAuth(req).userId, query);
  res
    .status(200)
    .type('text/csv')
    .attachment(`mission-control-applications-${today()}.csv`)
    .send(csv);
}

export async function accountJson(req: Request, res: Response): Promise<void> {
  const data = await exportsService.accountJson(getAuth(req).userId);
  res.status(200).attachment(`mission-control-export-${today()}.json`).json(data);
}
