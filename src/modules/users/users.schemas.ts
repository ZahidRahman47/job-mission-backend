// Request and response shapes for the users module (profile, preferences, notifications).
import { z } from 'zod';
import { isValidTimeZone } from '../../lib/time.ts';

export const WORK_MODE_PREFERENCES = ['remote', 'hybrid', 'onsite', 'any'] as const;

const timezone = z
  .string()
  .refine(isValidTimeZone, 'Must be a valid IANA time zone, e.g. Asia/Karachi.')
  .meta({ examples: ['Asia/Karachi'] });

const shortList = z.array(z.string().trim().min(1).max(100)).max(10);

export const preferencesSchema = z
  .strictObject({
    targetTitles: shortList.meta({ examples: [['Senior Backend Engineer']] }),
    targetLocations: shortList.meta({ examples: [['Remote', 'Berlin']] }),
    workMode: z.enum(WORK_MODE_PREFERENCES),
    weeklyGoal: z.number().int().min(0).max(200).meta({ description: 'Applications per week.' }),
  })
  .meta({ id: 'Preferences' });

export const notificationsSchema = z
  .strictObject({
    reminderEmails: z.boolean(),
    dailyDigest: z.boolean(),
    digestHour: z.number().int().min(0).max(23).meta({ description: 'Local hour, 0-23.' }),
  })
  .meta({ id: 'NotificationSettings' });

export const updateProfileBody = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    timezone: timezone.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to update.')
  .meta({ id: 'UpdateProfileRequest' });

export const publicUserSchema = z
  .object({
    id: z.string().meta({ examples: ['6720f1c2a1b2c3d4e5f60718'] }),
    name: z.string().meta({ examples: ['Ada Lovelace'] }),
    email: z.email().meta({ examples: ['ada@example.com'] }),
    timezone: z.string().meta({ examples: ['Asia/Karachi'] }),
    emailVerified: z.boolean(),
    isDemo: z.boolean(),
    preferences: preferencesSchema,
    notifications: notificationsSchema,
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'User' });

export type PublicUser = z.infer<typeof publicUserSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type NotificationSettings = z.infer<typeof notificationsSchema>;
export type ProfileUpdate = z.infer<typeof updateProfileBody>;

export const userResponseSchema = z.object({ data: publicUserSchema }).meta({ id: 'UserResponse' });
