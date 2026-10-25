// Profile reads/updates and the user operations other modules need. Other modules call this
// service, never the users repository or model directly (architecture.md 2.1).
import { NotFoundError } from '../../lib/errors.ts';
import type { UserRecord } from './users.model.ts';
import * as usersRepository from './users.repository.ts';
import type {
  NotificationSettings,
  Preferences,
  ProfileUpdate,
  PublicUser,
} from './users.schemas.ts';

// The only shape of a user that ever leaves the API: no passwordHash, no internal flags.
export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    timezone: user.timezone,
    emailVerified: user.emailVerifiedAt != null,
    isDemo: user.isDemo,
    preferences: {
      targetTitles: user.preferences.targetTitles,
      targetLocations: user.preferences.targetLocations,
      workMode: user.preferences.workMode,
      weeklyGoal: user.preferences.weeklyGoal,
    },
    notifications: {
      reminderEmails: user.notifications.reminderEmails,
      dailyDigest: user.notifications.dailyDigest,
      digestHour: user.notifications.digestHour,
    },
    createdAt: user.createdAt.toISOString(),
  };
}

async function updateOrThrow(userId: string, fields: Record<string, unknown>): Promise<PublicUser> {
  const user = await usersRepository.updateFields(userId, fields);
  if (!user) throw new NotFoundError('User');
  return toPublicUser(user);
}

export async function getProfile(userId: string): Promise<PublicUser> {
  const user = await usersRepository.findById(userId);
  if (!user) throw new NotFoundError('User');
  return toPublicUser(user);
}

export function updateProfile(userId: string, update: ProfileUpdate): Promise<PublicUser> {
  return updateOrThrow(userId, update);
}

// PUT semantics: the whole object is replaced, so the client always sends the full settings.
export function setPreferences(userId: string, preferences: Preferences): Promise<PublicUser> {
  return updateOrThrow(userId, { preferences });
}

export function setNotifications(
  userId: string,
  notifications: NotificationSettings,
): Promise<PublicUser> {
  return updateOrThrow(userId, { notifications });
}

// Used by analytics, reminders and list filters to interpret "today" and date ranges.
export async function getTimezone(userId: string): Promise<string> {
  return (await usersRepository.findById(userId))?.timezone ?? 'UTC';
}

export async function getWeeklyGoal(userId: string): Promise<number> {
  return (await usersRepository.findById(userId))?.preferences.weeklyGoal ?? 0;
}

export const {
  findById,
  findByIdWithPassword,
  findByEmail,
  findByEmailWithPassword,
  create: createUser,
  setPasswordHash,
  markEmailVerified,
  markDeletionRequested,
  deleteById: deleteUser,
  findIdsPendingDeletion,
} = usersRepository;
