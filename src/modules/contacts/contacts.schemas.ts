// Request and response shapes for contacts and contact interactions.
import { z } from 'zod';
import { pageMetaSchema } from '../../lib/pagination.ts';
import {
  cursorQueryFields,
  instantSchema,
  objectIdSchema,
  optionalText,
  pageQueryFields,
} from '../../lib/schemas.ts';

export const INTERACTION_CHANNELS = ['email', 'linkedin', 'call', 'meeting', 'other'] as const;

const contactFields = {
  companyId: objectIdSchema.nullable().optional(),
  title: optionalText(150).meta({ examples: ['Senior Technical Recruiter'] }),
  email: z
    .email()
    .max(254)
    .nullable()
    .optional()
    .meta({ examples: ['jane@acme.example'] }),
  phone: optionalText(40),
  linkedinUrl: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullable()
    .optional()
    .meta({ examples: ['https://www.linkedin.com/in/jane-doe'] }),
  notes: optionalText(5000),
};

export const createContactBody = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(150)
      .meta({ examples: ['Jane Doe'] }),
    ...contactFields,
  })
  .meta({ id: 'CreateContactRequest' });

export const updateContactBody = z
  .strictObject({ name: z.string().trim().min(1).max(150).optional(), ...contactFields })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to update.')
  .meta({ id: 'UpdateContactRequest' });

export const listContactsQuery = z.strictObject({
  q: z.string().trim().min(1).max(100).optional().meta({ description: 'Part of the name.' }),
  companyId: objectIdSchema.optional(),
  ...pageQueryFields,
});

export const interactionBody = z
  .strictObject({
    channel: z.enum(INTERACTION_CHANNELS),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .meta({ examples: ['Intro call, sent CV'] }),
    occurredAt: instantSchema.optional(),
    applicationId: objectIdSchema.optional(),
  })
  .meta({ id: 'InteractionRequest' });

export const interactionsQuery = z.strictObject(cursorQueryFields);

export const contactSchema = z
  .object({
    id: objectIdSchema,
    companyId: objectIdSchema.nullable(),
    name: z.string(),
    title: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    linkedinUrl: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Contact' });

export type ContactView = z.infer<typeof contactSchema>;
export type CreateContactInput = z.infer<typeof createContactBody>;
export type UpdateContactInput = z.infer<typeof updateContactBody>;
export type InteractionInput = z.infer<typeof interactionBody>;

export const contactResponseSchema = z
  .object({ data: contactSchema })
  .meta({ id: 'ContactResponse' });
export const contactListResponseSchema = z
  .object({ data: z.array(contactSchema), meta: pageMetaSchema })
  .meta({ id: 'ContactListResponse' });
