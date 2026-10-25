// Mongoose schema for single-use email-verification and password-reset tokens + TTL index
// (implementation-plan.md 3.3).
import { model, Schema, type InferSchemaType, type Types } from 'mongoose';

export const AUTH_TOKEN_TYPES = ['verify_email', 'reset_password'] as const;
export type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[number];

const authTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    type: { type: String, enum: AUTH_TOKEN_TYPES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);

authTokenSchema.index({ userId: 1, type: 1 });
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AuthTokenRecord = InferSchemaType<typeof authTokenSchema> & { _id: Types.ObjectId };

export const AuthTokenModel = model('AuthToken', authTokenSchema);
