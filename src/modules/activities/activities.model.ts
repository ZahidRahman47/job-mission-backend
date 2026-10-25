// Mongoose schema for activities: the timeline of an application and the global activity feed
// (implementation-plan.md 3.7). A separate collection because it grows without bound.
import { model, Schema, type InferSchemaType, type Types } from 'mongoose';

export const ACTIVITY_TYPES = [
  'created',
  'status_changed',
  'reopened',
  'note',
  'interview_added',
  'interview_updated',
  'reminder_completed',
  'archived',
  'restored',
  'contact_interaction',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const activitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    applicationId: { type: Schema.Types.ObjectId, default: null },
    contactId: { type: Schema.Types.ObjectId, default: null },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    // Type-specific details, e.g. { from, to } or { body }. Includes snapshots such as
    // applicationTitle/companyName so the feed renders without joining other collections.
    data: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw', minimize: false },
);

activitySchema.index({ userId: 1, applicationId: 1, occurredAt: -1, _id: -1 }); // timeline
activitySchema.index({ userId: 1, occurredAt: -1, _id: -1 }); // feed
activitySchema.index({ userId: 1, contactId: 1, occurredAt: -1 }); // contact history

// `data` is Mixed (typed `any` by Mongoose); narrow it to an object of unknown values.
export type ActivityRecord = Omit<InferSchemaType<typeof activitySchema>, 'data'> & {
  _id: Types.ObjectId;
  data: Record<string, unknown>;
};

export const ActivityModel = model('Activity', activitySchema);
