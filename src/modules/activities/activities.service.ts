// Records timeline events and serves the per-application timeline, contact history and the
// global activity feed (FR-033, FR-040, FR-053). System events are append-only; only notes and
// contact interactions are user-editable.
import { NotFoundError } from '../../lib/errors.ts';
import { decodeCursor, encodeCursor } from '../../lib/pagination.ts';
import type { ActivityRecord } from './activities.model.ts';
import * as activitiesRepository from './activities.repository.ts';
import type { NewActivity } from './activities.repository.ts';
import type { ActivityView } from './activities.schemas.ts';

export type { NewActivity };

export function toActivityView(activity: ActivityRecord): ActivityView {
  return {
    id: activity._id.toString(),
    type: activity.type,
    applicationId: activity.applicationId?.toString() ?? null,
    contactId: activity.contactId?.toString() ?? null,
    occurredAt: activity.occurredAt.toISOString(),
    data: activity.data,
  };
}

export async function record(activity: NewActivity): Promise<ActivityView> {
  return toActivityView(await activitiesRepository.insert(activity));
}

export const recordMany = activitiesRepository.insertMany;

interface CursorPage {
  data: ActivityView[];
  meta: { nextCursor: string | null };
}

async function page(
  userId: string,
  filter: { applicationId?: string; contactId?: string },
  cursor: string | undefined,
  limit: number,
): Promise<CursorPage> {
  const { items, hasMore } = await activitiesRepository.listPage(
    userId,
    filter,
    cursor === undefined ? undefined : decodeCursor(cursor),
    limit,
  );
  const last = items.at(-1);
  return {
    data: items.map(toActivityView),
    meta: {
      nextCursor:
        hasMore && last ? encodeCursor({ at: last.occurredAt, id: last._id.toString() }) : null,
    },
  };
}

export function listFeed(userId: string, cursor: string | undefined, limit: number) {
  return page(userId, {}, cursor, limit);
}

export function listForApplication(
  userId: string,
  applicationId: string,
  cursor: string | undefined,
  limit: number,
) {
  return page(userId, { applicationId }, cursor, limit);
}

export function listForContact(
  userId: string,
  contactId: string,
  cursor: string | undefined,
  limit: number,
) {
  return page(userId, { contactId }, cursor, limit);
}

export async function updateNote(
  userId: string,
  applicationId: string,
  noteId: string,
  body: string,
): Promise<ActivityView> {
  const note = await activitiesRepository.updateNoteBody(userId, applicationId, noteId, body);
  if (!note) throw new NotFoundError('Note');
  return toActivityView(note);
}

export async function deleteNote(
  userId: string,
  applicationId: string,
  noteId: string,
): Promise<void> {
  if (!(await activitiesRepository.deleteNote(userId, applicationId, noteId))) {
    throw new NotFoundError('Note');
  }
}

export const { deleteForApplication, deleteAllForUser } = activitiesRepository;

export async function exportAll(userId: string): Promise<ActivityView[]> {
  return (await activitiesRepository.listAllForUser(userId)).map(toActivityView);
}
