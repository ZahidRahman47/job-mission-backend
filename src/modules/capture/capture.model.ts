// Mongoose schemas for email capture (email-capture.md §0, §3.2): the personal ingest token the
// Gmail script authenticates with, and the raw emails it sends, kept 30 days for processing.
import { model, Schema, type InferSchemaType, type Types } from 'mongoose';

export const EMAIL_DIRECTIONS = ['received', 'sent'] as const;
export const INBOUND_STATES = ['received', 'processing', 'processed', 'ignored', 'failed'] as const;

// created: a new application · duplicate: already tracked · no_rule: no rule matched (the LLM stage
// will pick these up when it exists).
export const CAPTURE_OUTCOMES = ['created', 'duplicate', 'no_rule'] as const;
export type CaptureOutcome = (typeof CAPTURE_OUTCOMES)[number];

export const RAW_EMAIL_TTL_SECONDS = 30 * 24 * 60 * 60;

// One active token per user; creating a new one replaces it. Only the SHA-256 is stored.
const captureTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    tokenHash: { type: String, required: true },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);

captureTokenSchema.index({ userId: 1 }, { unique: true });
captureTokenSchema.index({ tokenHash: 1 }, { unique: true });

const inboundEmailSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    // Gmail's message ID: the script may resend a message, the unique index makes that a no-op.
    gmailId: { type: String, required: true, maxlength: 64 },
    threadId: { type: String, required: true, maxlength: 64 },
    direction: { type: String, enum: EMAIL_DIRECTIONS, required: true },
    from: { type: String, required: true, maxlength: 320 },
    to: { type: [String], default: [] },
    subject: { type: String, maxlength: 1000, default: '' },
    text: { type: String, maxlength: 100_000, default: '' },
    // The HTML part converted to text at ingest (the raw HTML is never stored).
    htmlText: { type: String, maxlength: 100_000, default: '' },
    sentAt: { type: Date, required: true },
    state: { type: String, enum: INBOUND_STATES, required: true, default: 'received' },
    attempts: { type: Number, required: true, default: 0 },
    leaseUntil: { type: Date, default: null },
    error: { type: String, maxlength: 500, default: null },
    // What processing did, for debugging and the future inbox: see CAPTURE_OUTCOMES.
    outcome: { type: String, enum: CAPTURE_OUTCOMES, default: null },
    applicationId: { type: Schema.Types.ObjectId, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);

inboundEmailSchema.index({ userId: 1, gmailId: 1 }, { unique: true });
// The next email to process for a user: its waiting ones, oldest first (leaseNext).
inboundEmailSchema.index({ userId: 1, state: 1, sentAt: 1 });
inboundEmailSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type CaptureTokenRecord = InferSchemaType<typeof captureTokenSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export type InboundEmailRecord = InferSchemaType<typeof inboundEmailSchema> & {
  _id: Types.ObjectId;
};

export const CaptureTokenModel = model('CaptureToken', captureTokenSchema);
export const InboundEmailModel = model('InboundEmail', inboundEmailSchema);
