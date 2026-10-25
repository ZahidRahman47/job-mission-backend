// Mongoose schema for sessions (tokenHash, expiry, idle expiry) + TTL index (implementation-plan.md 3.2).
import { model, Schema, type InferSchemaType, type Types } from 'mongoose';

const sessionSchema = new Schema(
  {
    // SHA-256 of the cookie value. The raw token is never stored.
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true, immutable: true },
    expiresAt: { type: Date, required: true },
    idleExpiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    userAgent: { type: String, maxlength: 300, default: null },
    // Only the network prefix (/24 IPv4, /48 IPv6): enough to recognise a device, less personal data.
    ipPrefix: { type: String, maxlength: 64, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);

// MongoDB deletes the document automatically once expiresAt has passed (checked about every 60 s).
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SessionRecord = InferSchemaType<typeof sessionSchema> & { _id: Types.ObjectId };

export const SessionModel = model('Session', sessionSchema);
