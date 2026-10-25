// HTTP <-> applications service.
import type { Request, Response } from 'express';
import { idParams } from '../../lib/schemas.ts';
import { parseInput } from '../../lib/validation.ts';
import { getAuth } from '../../middleware/require-auth.ts';
import { noteBody, noteUpdateBody } from '../activities/activities.schemas.ts';
import {
  createApplicationBody,
  interviewBody,
  interviewParams,
  interviewUpdateBody,
  listApplicationsQuery,
  noteParams,
  setContactsBody,
  statusChangeBody,
  timelineQuery,
  updateApplicationBody,
} from './applications.schemas.ts';
import * as applicationsService from './applications.service.ts';

const userOf = (req: Request): string => getAuth(req).userId;
const idOf = (req: Request): string => parseInput(idParams, req.params, 'params').id;

export async function list(req: Request, res: Response): Promise<void> {
  const query = parseInput(listApplicationsQuery, req.query, 'query');
  res.status(200).json(await applicationsService.list(userOf(req), query));
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = parseInput(createApplicationBody, req.body, 'body');
  const app = await applicationsService.create(userOf(req), body);
  res.status(201).location(`/api/v1/applications/${app.id}`).json({ data: app });
}

export async function get(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await applicationsService.getDetail(userOf(req), idOf(req)) });
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = idOf(req);
  const body = parseInput(updateApplicationBody, req.body, 'body');
  res.status(200).json({ data: await applicationsService.update(userOf(req), id, body) });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await applicationsService.remove(userOf(req), idOf(req));
  res.status(204).end();
}

export async function changeStatus(req: Request, res: Response): Promise<void> {
  const id = idOf(req);
  const { to, version, appliedAt } = parseInput(statusChangeBody, req.body, 'body');
  res.status(200).json({
    data: await applicationsService.changeStatus(userOf(req), id, to, version, appliedAt),
  });
}

export async function archive(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await applicationsService.archive(userOf(req), idOf(req)) });
}

export async function restore(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await applicationsService.restore(userOf(req), idOf(req)) });
}

export async function listTimeline(req: Request, res: Response): Promise<void> {
  const id = idOf(req);
  const { cursor, limit } = parseInput(timelineQuery, req.query, 'query');
  res.status(200).json(await applicationsService.listTimeline(userOf(req), id, cursor, limit));
}

export async function addNote(req: Request, res: Response): Promise<void> {
  const id = idOf(req);
  const { body, occurredAt } = parseInput(noteBody, req.body, 'body');
  res
    .status(201)
    .json({ data: await applicationsService.addNote(userOf(req), id, body, occurredAt) });
}

export async function updateNote(req: Request, res: Response): Promise<void> {
  const { id, noteId } = parseInput(noteParams, req.params, 'params');
  const { body } = parseInput(noteUpdateBody, req.body, 'body');
  res
    .status(200)
    .json({ data: await applicationsService.updateNote(userOf(req), id, noteId, body) });
}

export async function deleteNote(req: Request, res: Response): Promise<void> {
  const { id, noteId } = parseInput(noteParams, req.params, 'params');
  await applicationsService.deleteNote(userOf(req), id, noteId);
  res.status(204).end();
}

export async function addInterview(req: Request, res: Response): Promise<void> {
  const id = idOf(req);
  const body = parseInput(interviewBody, req.body, 'body');
  res.status(201).json({ data: await applicationsService.addInterview(userOf(req), id, body) });
}

export async function updateInterview(req: Request, res: Response): Promise<void> {
  const { id, interviewId } = parseInput(interviewParams, req.params, 'params');
  const body = parseInput(interviewUpdateBody, req.body, 'body');
  res
    .status(200)
    .json({ data: await applicationsService.updateInterview(userOf(req), id, interviewId, body) });
}

export async function removeInterview(req: Request, res: Response): Promise<void> {
  const { id, interviewId } = parseInput(interviewParams, req.params, 'params');
  res
    .status(200)
    .json({ data: await applicationsService.removeInterview(userOf(req), id, interviewId) });
}

export async function setContacts(req: Request, res: Response): Promise<void> {
  const id = idOf(req);
  const { contactIds } = parseInput(setContactsBody, req.body, 'body');
  res
    .status(200)
    .json({ data: await applicationsService.setContacts(userOf(req), id, contactIds) });
}
