// HTTP <-> users service.
import type { Request, Response } from 'express';
import { parseInput } from '../../lib/validation.ts';
import { getAuth } from '../../middleware/require-auth.ts';
import { notificationsSchema, preferencesSchema, updateProfileBody } from './users.schemas.ts';
import * as usersService from './users.service.ts';

export async function getMe(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await usersService.getProfile(getAuth(req).userId) });
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const body = parseInput(updateProfileBody, req.body, 'body');
  res.status(200).json({ data: await usersService.updateProfile(getAuth(req).userId, body) });
}

export async function setPreferences(req: Request, res: Response): Promise<void> {
  const body = parseInput(preferencesSchema, req.body, 'body');
  res.status(200).json({ data: await usersService.setPreferences(getAuth(req).userId, body) });
}

export async function setNotifications(req: Request, res: Response): Promise<void> {
  const body = parseInput(notificationsSchema, req.body, 'body');
  res.status(200).json({ data: await usersService.setNotifications(getAuth(req).userId, body) });
}
