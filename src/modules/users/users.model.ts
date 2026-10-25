// Mongoose schema for users with embedded preferences and notification settings
// (implementation-plan.md 3.1). Preferences and notifications are embedded: small, 1:1, always
// read with the user.
import { model, Schema, type InferSchemaType, type Types } from 'mongoose';

const preferencesSchema = new Schema(
  {
    targetTitles: { type: [String], default: [] },
    targetLocations: { type: [String], default: [] },
    workMode: { type: String, enum: ['remote', 'hybrid', 'onsite', 'any'], default: 'any' },
    weeklyGoal: { type: Number, min: 0, max: 200, default: 0 },
  },
  { _id: false },
);

const notificationsSchema = new Schema(
  {
    reminderEmails: { type: Boolean, default: true },
    dailyDigest: { type: Boolean, default: false },
    digestHour: { type: Number, min: 0, max: 23, default: 8 },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    // `unique` creates the unique index that is the final guard against duplicate accounts.
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      unique: true,
    },
    // Never returned by queries unless explicitly requested with .select('+passwordHash').
    // Nullable for future OAuth-only accounts (ADR-011); v1 always sets it.
    passwordHash: { type: String, default: null, select: false },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    timezone: { type: String, required: true, default: 'UTC' },
    emailVerifiedAt: { type: Date, default: null },
    preferences: { type: preferencesSchema, default: () => ({}) },
    notifications: { type: notificationsSchema, default: () => ({}) },
    isDemo: { type: Boolean, default: false },
    demoExpiresAt: { type: Date, default: null },
    // Set at the start of account deletion; blocks login and lets an interrupted deletion resume (BR-022).
    deletionRequestedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: 'throw' },
);

export type UserRecord = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

export const UserModel = model('User', userSchema);
