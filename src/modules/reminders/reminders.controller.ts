// HTTP <-> reminders service.
import type { Request, Response } from 'express';
import { idParams } from '../../lib/schemas.ts';
import { parseInput } from '../../lib/validation.ts';
import { getAuth } from '../../middleware/require-auth.ts';
import { createReminderBody, listRemindersQuery, updateReminderBody } from './reminders.schemas.ts';
import * as remindersService from './reminders.service.ts';

const userOf = (req: Request): string => getAuth(req).userId;
const idOf = (req: Request): string => parseInput(idParams, req.params, 'params').id;

export async function list(req: Request, res: Response): Promise<void> {
  const query = parseInput(listRemindersQuery, req.query, 'query');
  res.status(200).json(await remindersService.list(userOf(req), query));
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = parseInput(createReminderBody, req.body, 'body');
  const reminder = await remindersService.create(userOf(req), body);
  res.status(201).location(`/api/v1/reminders/${reminder.id}`).json({ data: reminder });
}

export async function get(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await remindersService.get(userOf(req), idOf(req)) });
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = idOf(req);
  const body = parseInput(updateReminderBody, req.body, 'body');
  res.status(200).json({ data: await remindersService.update(userOf(req), id, body) });
}

export async function complete(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await remindersService.complete(userOf(req), idOf(req)) });
}

export async function reopen(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await remindersService.reopen(userOf(req), idOf(req)) });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await remindersService.remove(userOf(req), idOf(req));
  res.status(204).end();
}
