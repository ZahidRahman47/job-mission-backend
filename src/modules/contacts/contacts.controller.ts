// HTTP <-> contacts service.
import type { Request, Response } from 'express';
import { idParams } from '../../lib/schemas.ts';
import { parseInput } from '../../lib/validation.ts';
import { getAuth } from '../../middleware/require-auth.ts';
import {
  createContactBody,
  interactionBody,
  interactionsQuery,
  listContactsQuery,
  updateContactBody,
} from './contacts.schemas.ts';
import * as contactsService from './contacts.service.ts';

export async function list(req: Request, res: Response): Promise<void> {
  const query = parseInput(listContactsQuery, req.query, 'query');
  res.status(200).json(await contactsService.list(getAuth(req).userId, query));
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = parseInput(createContactBody, req.body, 'body');
  const contact = await contactsService.create(getAuth(req).userId, body);
  res.status(201).location(`/api/v1/contacts/${contact.id}`).json({ data: contact });
}

export async function get(req: Request, res: Response): Promise<void> {
  const { id } = parseInput(idParams, req.params, 'params');
  res.status(200).json({ data: await contactsService.get(getAuth(req).userId, id) });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = parseInput(idParams, req.params, 'params');
  const body = parseInput(updateContactBody, req.body, 'body');
  res.status(200).json({ data: await contactsService.update(getAuth(req).userId, id, body) });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = parseInput(idParams, req.params, 'params');
  await contactsService.remove(getAuth(req).userId, id);
  res.status(204).end();
}

export async function listInteractions(req: Request, res: Response): Promise<void> {
  const { id } = parseInput(idParams, req.params, 'params');
  const { cursor, limit } = parseInput(interactionsQuery, req.query, 'query');
  res
    .status(200)
    .json(await contactsService.listInteractions(getAuth(req).userId, id, cursor, limit));
}

export async function addInteraction(req: Request, res: Response): Promise<void> {
  const { id } = parseInput(idParams, req.params, 'params');
  const body = parseInput(interactionBody, req.body, 'body');
  res
    .status(201)
    .json({ data: await contactsService.addInteraction(getAuth(req).userId, id, body) });
}
