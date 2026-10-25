// Mongoose schema for reminders + unique partial index against duplicates (implementation-plan.md 3.8).
import { model, Schema, type InferSchemaType, type Types } from 'mongoose';

const reminderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    applicationId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    note: { type: String, maxlength: 2000, default: '' },
    dueAt: { type: Date, required: true }, // UTC, truncated to the minute
    status: { type: String, enum: ['pending', 'completed'], required: true, default: 'pending' },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: 'throw' },
);

reminderSchema.index({ userId: 1, status: 1, dueAt: 1 }); // overdue / today / upcoming views
reminderSchema.index({ userId: 1, applicationId: 1, status: 1, dueAt: 1 }); // nextFollowUpAt
// FR-044: no two *pending* reminders for the same application at the same minute. The database
// enforces it, so even two simultaneous clicks can't create a duplicate.
reminderSchema.index(
  { userId: 1, applicationId: 1, dueAt: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending', applicationId: { $type: 'objectId' } },
  },
);

export type ReminderRecord = InferSchemaType<typeof reminderSchema> & { _id: Types.ObjectId };

export const ReminderModel = model('Reminder', reminderSchema);
