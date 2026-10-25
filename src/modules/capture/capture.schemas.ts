// Zod schemas for email capture: the Gmail script's payload and the token responses.
import { z } from 'zod';
import { EMAIL_DIRECTIONS } from './capture.model.ts';

// At most 20 emails per call keeps each request well under the 2 MB body limit.
export const MAX_EMAILS_PER_CALL = 20;

const inboundEmailSchema = z.strictObject({
  gmailId: z.string().min(1).max(64),
  threadId: z.string().min(1).max(64),
  direction: z.enum(EMAIL_DIRECTIONS),
  // Raw header values, e.g. `"Jobs" <jobs-noreply@linkedin.com>`.
  from: z.string().min(1).max(320),
  to: z.array(z.string().max(320)).max(50).default([]),
  subject: z.string().max(1000).default(''),
  sentAt: z.iso.datetime({ offset: true }),
  // The script sends plain text, trimmed to 100,000 characters.
  text: z.string().max(100_000).default(''),
});

export const ingestGmailBody = z
  .strictObject({
    messages: z.array(inboundEmailSchema).min(1).max(MAX_EMAILS_PER_CALL),
  })
  .meta({ id: 'IngestGmailRequest' });

export type IngestGmailBody = z.infer<typeof ingestGmailBody>;

export const ingestResultSchema = z
  .object({
    data: z.object({
      stored: z.number().int().meta({ description: 'Emails not seen before.' }),
      duplicates: z.number().int().meta({ description: 'Already stored; ignored.' }),
    }),
  })
  .meta({ id: 'IngestGmailResponse' });

export const captureTokenStatusSchema = z
  .object({
    data: z.object({
      active: z.boolean(),
      createdAt: z.iso.datetime().nullable(),
      lastUsedAt: z.iso.datetime().nullable(),
    }),
  })
  .meta({ id: 'CaptureTokenStatusResponse' });

export const createdCaptureTokenSchema = z
  .object({
    data: z.object({
      token: z.string().meta({ description: 'Shown once. Paste it into the Gmail script.' }),
      createdAt: z.iso.datetime(),
    }),
  })
  .meta({ id: 'CreatedCaptureTokenResponse' });
