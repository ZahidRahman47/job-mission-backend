// HTTP <-> imports service. The CSV is sent as the raw request body (Content-Type: text/csv).
import type { Request, Response } from 'express';
import { AppError } from '../../lib/errors.ts';
import { idParams } from '../../lib/schemas.ts';
import { parseInput } from '../../lib/validation.ts';
import { getAuth } from '../../middleware/require-auth.ts';
import { importQuery } from './imports.schemas.ts';
import * as importsService from './imports.service.ts';

export function template(_req: Request, res: Response): void {
  res
    .status(200)
    .type('text/csv')
    .attachment('mission-control-import-template.csv')
    .send(importsService.templateCsv());
}

export async function importApplications(req: Request, res: Response): Promise<void> {
  // express.text() only parses text/csv bodies; anything else leaves req.body unset.
  const body: unknown = req.body;
  if (typeof body !== 'string') {
    throw new AppError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Send the file as the body with Content-Type: text/csv.',
    );
  }
  const { fileName } = parseInput(importQuery, req.query, 'query');
  const report = await importsService.importApplications(
    getAuth(req).userId,
    body,
    fileName ?? null,
  );
  res.status(201).json({ data: report });
}

export async function getReport(req: Request, res: Response): Promise<void> {
  const { id } = parseInput(idParams, req.params, 'params');
  res.status(200).json({ data: await importsService.getReport(getAuth(req).userId, id) });
}
