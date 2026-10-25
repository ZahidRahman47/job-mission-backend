// Request and response shapes for companies.
import { z } from 'zod';
import { pageMetaSchema } from '../../lib/pagination.ts';
import { objectIdSchema, optionalText, pageQueryFields } from '../../lib/schemas.ts';

const website = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .nullable()
  .optional()
  .meta({ examples: ['https://acme.example'] });

const companyFields = {
  website,
  industry: optionalText(100).meta({ examples: ['Fintech'] }),
  location: optionalText(200).meta({ examples: ['Berlin, Germany'] }),
  notes: optionalText(5000),
};

export const createCompanyBody = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .meta({ examples: ['Acme Corp'] }),
    ...companyFields,
  })
  .meta({ id: 'CreateCompanyRequest' });

export const updateCompanyBody = z
  .strictObject({ name: z.string().trim().min(1).max(200).optional(), ...companyFields })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to update.')
  .meta({ id: 'UpdateCompanyRequest' });

export const listCompaniesQuery = z.strictObject({
  q: z.string().trim().min(1).max(100).optional().meta({ description: 'Name prefix (typeahead).' }),
  ...pageQueryFields,
});

export const companySchema = z
  .object({
    id: objectIdSchema,
    name: z.string(),
    website: z.string().nullable(),
    industry: z.string().nullable(),
    location: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Company' });

export const companyListItemSchema = companySchema
  .extend({ applicationCount: z.number().int() })
  .meta({ id: 'CompanyListItem' });

export const companyDetailSchema = companySchema
  .extend({
    applicationCount: z.number().int(),
    contacts: z.array(
      z.object({ id: objectIdSchema, name: z.string(), title: z.string().nullable() }),
    ),
  })
  .meta({ id: 'CompanyDetail' });

export type CompanyView = z.infer<typeof companySchema>;
export type CompanyDetailView = z.infer<typeof companyDetailSchema>;
export type CompanyListItemView = z.infer<typeof companyListItemSchema>;
export type CreateCompanyInput = z.infer<typeof createCompanyBody>;
export type UpdateCompanyInput = z.infer<typeof updateCompanyBody>;

export const companyResponseSchema = z
  .object({ data: companySchema })
  .meta({ id: 'CompanyResponse' });
export const companyDetailResponseSchema = z
  .object({ data: companyDetailSchema })
  .meta({ id: 'CompanyDetailResponse' });
export const companyListResponseSchema = z
  .object({ data: z.array(companyListItemSchema), meta: pageMetaSchema })
  .meta({ id: 'CompanyListResponse' });
