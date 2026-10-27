// Mongoose schema for contacts: recruiters, hiring managers, referrers (implementation-plan.md 3.5).
import { model, Schema, type InferSchemaType, type Types } from 'mongoose';

const contactSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    companyId: { type: Schema.Types.ObjectId, default: null },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    title: { type: String, maxlength: 150, default: null },
    email: { type: String, maxlength: 254, default: null },
    phone: { type: String, maxlength: 40, default: null },
    linkedinUrl: { type: String, maxlength: 500, default: null },
    notes: { type: String, maxlength: 5000, default: null },
  },
  { timestamps: true, strict: 'throw' },
);

contactSchema.index({ userId: 1, companyId: 1 });
// List order (name, then _id for people with the same name), served by the index.
contactSchema.index({ userId: 1, name: 1, _id: 1 });

export type ContactRecord = InferSchemaType<typeof contactSchema> & { _id: Types.ObjectId };

export const ContactModel = model('Contact', contactSchema);
