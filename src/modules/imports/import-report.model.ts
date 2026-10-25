// Mongoose schema for import reports (totals + row errors), kept for 30 days (implementation-plan.md 3.9).
import { model, Schema, type InferSchemaType, type Types } from 'mongoose';

const importReportSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    fileName: { type: String, maxlength: 255, default: null },
    totals: {
      rows: { type: Number, required: true },
      created: { type: Number, required: true },
      skipped: { type: Number, required: true },
      failed: { type: Number, required: true },
    },
    // At most 500 entries are stored; `totals.failed` has the full count. (Not named `errors`:
    // that is reserved on Mongoose documents for validation errors.)
    rowErrors: [{ _id: false, row: Number, column: String, message: String }],
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);

importReportSchema.index({ userId: 1, createdAt: -1 });
importReportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export type ImportReportRecord = InferSchemaType<typeof importReportSchema> & {
  _id: Types.ObjectId;
};

export const ImportReportModel = model('ImportReport', importReportSchema);
