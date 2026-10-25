// Swagger documentation for /companies.
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { errors, jsonContent, ok, security } from '../../lib/openapi.ts';
import { idParams } from '../../lib/schemas.ts';
import {
  companyDetailResponseSchema,
  companyListResponseSchema,
  companyResponseSchema,
  createCompanyBody,
  listCompaniesQuery,
  updateCompanyBody,
} from './companies.schemas.ts';

const tags = ['Companies'];

export const companiesPaths: ZodOpenApiPathsObject = {
  '/companies': {
    get: {
      tags,
      summary: 'List my companies (A-Z, with name-prefix search for typeahead)',
      security: security.sessionRead,
      requestParams: { query: listCompaniesQuery },
      responses: {
        '200': ok('A page of companies.', companyListResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
      },
    },
    post: {
      tags,
      summary: 'Create a company',
      description:
        'Names are unique per user, ignoring case and extra spaces. A duplicate returns 409 `ALREADY_EXISTS` with `details.existingId`.',
      security: security.sessionWrite,
      requestBody: { content: jsonContent(createCompanyBody) },
      responses: {
        '201': ok('Created.', companyResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
        '409': errors.conflict,
      },
    },
  },
  '/companies/{id}': {
    get: {
      tags,
      summary: 'Get a company with its application count and contacts',
      security: security.sessionRead,
      requestParams: { path: idParams },
      responses: {
        '200': ok('The company.', companyDetailResponseSchema),
        '401': errors.unauthenticated,
        '404': errors.notFound,
      },
    },
    patch: {
      tags,
      summary: 'Update a company',
      description: 'Renaming also updates the company name shown on its applications.',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      requestBody: { content: jsonContent(updateCompanyBody) },
      responses: {
        '200': ok('Updated.', companyResponseSchema),
        '400': errors.validation,
        '401': errors.unauthenticated,
        '404': errors.notFound,
        '409': errors.conflict,
      },
    },
    delete: {
      tags,
      summary: 'Delete a company',
      description:
        'Blocked with 409 `COMPANY_IN_USE` while applications reference it. Its contacts are kept and unlinked.',
      security: security.sessionWrite,
      requestParams: { path: idParams },
      responses: {
        '204': { description: 'Deleted.' },
        '401': errors.unauthenticated,
        '404': errors.notFound,
        '409': errors.conflict,
      },
    },
  },
};
