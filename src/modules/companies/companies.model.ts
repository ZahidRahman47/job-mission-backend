// Mongoose schema for companies + unique (userId, normalizedName) index (implementation-plan.md 3.4).
import { model, Schema, type InferSchemaType, type Types } from 'mongoose';

const companySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    // Server-derived: trimmed, single spaces, lowercase. "  ACME  corp" and "Acme Corp" collide.
    normalizedName: { type: String, required: true },
    website: { type: String, maxlength: 500, default: null },
    industry: { type: String, maxlength: 100, default: null },
    location: { type: String, maxlength: 200, default: null },
    notes: { type: String, maxlength: 5000, default: null },
  },
  { timestamps: true, strict: 'throw' },
);

// One company per name per user. Also serves typeahead: an anchored regex (^acm) uses this index.
companySchema.index({ userId: 1, normalizedName: 1 }, { unique: true });

export type CompanyRecord = InferSchemaType<typeof companySchema> & { _id: Types.ObjectId };

export const CompanyModel = model('Company', companySchema);
