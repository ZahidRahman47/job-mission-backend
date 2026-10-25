// Request and response schemas for auth and account endpoints. One definition drives validation,
// TypeScript types and the Swagger docs.
import { z } from 'zod';
import { isValidTimeZone } from '../../lib/time.ts';

// Trim + lowercase before checking, so " Ada@Example.com " and "ada@example.com" are one account.
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email())
  .meta({ examples: ['ada@example.com'] });

// NIST 800-63B: length matters, composition rules ("1 symbol, 1 digit") don't.
const newPassword = z
  .string()
  .min(12, 'Must be at least 12 characters.')
  .max(128, 'Must be at most 128 characters.')
  .meta({ examples: ['correct-horse-battery-staple'] });

// Login and re-auth fields don't reveal the password policy; they only bound the size.
const existingPassword = z
  .string()
  .min(1)
  .max(128)
  .meta({ examples: ['correct-horse-battery-staple'] });

const token = z.string().min(20).max(200).meta({ description: 'Token from the emailed link.' });

const objectId = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, 'Must be a valid id.')
  .meta({ examples: ['6720f1c2a1b2c3d4e5f60718'] });

// strictObject: unknown fields are rejected, never silently ignored (mass assignment, NFR-010).
export const registerBody = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .meta({ examples: ['Ada Lovelace'] }),
    email,
    password: newPassword,
    timezone: z
      .string()
      .refine(isValidTimeZone, 'Must be a valid IANA time zone, e.g. Asia/Karachi.')
      .default('UTC')
      .meta({ examples: ['Asia/Karachi'] }),
  })
  .meta({ id: 'RegisterRequest' });

export const loginBody = z
  .strictObject({ email, password: existingPassword })
  .meta({ id: 'LoginRequest' });

export const verifyEmailBody = z.strictObject({ token }).meta({ id: 'VerifyEmailRequest' });

export const forgotPasswordBody = z.strictObject({ email }).meta({ id: 'ForgotPasswordRequest' });

export const resetPasswordBody = z
  .strictObject({ token, password: newPassword })
  .meta({ id: 'ResetPasswordRequest' });

export const changePasswordBody = z
  .strictObject({ currentPassword: existingPassword, newPassword })
  .meta({ id: 'ChangePasswordRequest' });

export const deleteAccountBody = z
  .strictObject({ password: existingPassword })
  .meta({ id: 'DeleteAccountRequest' });

export const sessionIdParams = z.strictObject({ sessionId: objectId });

export const messageResponseSchema = z
  .object({ data: z.object({ message: z.string() }) })
  .meta({ id: 'MessageResponse' });

export const sessionSchema = z
  .object({
    id: objectId,
    userAgent: z
      .string()
      .nullable()
      .meta({ examples: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)'] }),
    ipPrefix: z
      .string()
      .nullable()
      .meta({ examples: ['203.0.113.0/24'] }),
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime(),
    current: z.boolean().meta({ description: 'True for the session making this request.' }),
  })
  .meta({ id: 'Session' });

export const sessionListResponseSchema = z
  .object({ data: z.array(sessionSchema) })
  .meta({ id: 'SessionListResponse' });

export type RegisterInput = z.output<typeof registerBody>;
export type LoginInput = z.output<typeof loginBody>;
export type SessionView = z.infer<typeof sessionSchema>;
