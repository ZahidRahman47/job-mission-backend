// HTTP <-> companies service.
import type { Request, Response } from 'express';
import { idParams } from '../../lib/schemas.ts';
import { parseInput } from '../../lib/validation.ts';
import { getAuth } from '../../middleware/require-auth.ts';
import { createCompanyBody, listCompaniesQuery, updateCompanyBody } from './companies.schemas.ts';
import * as companiesService from './companies.service.ts';

export async function list(req: Request, res: Response): Promise<void> {
  const query = parseInput(listCompaniesQuery, req.query, 'query');
  res.status(200).json(await companiesService.list(getAuth(req).userId, query));
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = parseInput(createCompanyBody, req.body, 'body');
  const company = await companiesService.create(getAuth(req).userId, body);
  res.status(201).location(`/api/v1/companies/${company.id}`).json({ data: company });
}

export async function get(req: Request, res: Response): Promise<void> {
  const { id } = parseInput(idParams, req.params, 'params');
  res.status(200).json({ data: await companiesService.get(getAuth(req).userId, id) });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = parseInput(idParams, req.params, 'params');
  const body = parseInput(updateCompanyBody, req.body, 'body');
  res.status(200).json({ data: await companiesService.update(getAuth(req).userId, id, body) });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = parseInput(idParams, req.params, 'params');
  await companiesService.remove(getAuth(req).userId, id);
  res.status(204).end();
}
