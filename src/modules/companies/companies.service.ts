// Company rules: name normalization, duplicate handling, rename sync to applications,
// delete-in-use check (FR-035 to FR-038).
import { withTransaction } from '../../db/transaction.ts';
import { ConflictError, isDuplicateKeyError, NotFoundError } from '../../lib/errors.ts';
import { pageMeta, type PageMeta } from '../../lib/pagination.ts';
import * as applicationsService from '../applications/applications.service.ts';
import * as contactsService from '../contacts/contacts.service.ts';
import type { CompanyRecord } from './companies.model.ts';
import * as companiesRepository from './companies.repository.ts';
import type {
  CompanyDetailView,
  CompanyListItemView,
  CompanyView,
  CreateCompanyInput,
  UpdateCompanyInput,
} from './companies.schemas.ts';

export function normalizeCompanyName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function toCompanyView(company: CompanyRecord): CompanyView {
  return {
    id: company._id.toString(),
    name: company.name,
    website: company.website ?? null,
    industry: company.industry ?? null,
    location: company.location ?? null,
    notes: company.notes ?? null,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  };
}

async function duplicateError(userId: string, normalizedName: string): Promise<ConflictError> {
  const existing = await companiesRepository.findByNormalizedName(userId, normalizedName);
  return new ConflictError('ALREADY_EXISTS', 'A company with this name already exists.', {
    existingId: existing?._id.toString(),
  });
}

export async function getOwnedOrThrow(userId: string, id: string): Promise<CompanyRecord> {
  const company = await companiesRepository.findOwned(userId, id);
  if (!company) throw new NotFoundError('Company');
  return company;
}

export async function create(userId: string, input: CreateCompanyInput): Promise<CompanyView> {
  const normalizedName = normalizeCompanyName(input.name);
  try {
    return toCompanyView(await companiesRepository.create(userId, { ...input, normalizedName }));
  } catch (err) {
    if (isDuplicateKeyError(err)) throw await duplicateError(userId, normalizedName);
    throw err;
  }
}

// Used when an application or CSV row names a company: reuse it if it exists (FR-036).
// Runs inside the caller's transaction, so it must not start its own.
export async function findOrCreateByName(userId: string, name: string): Promise<CompanyRecord> {
  const normalizedName = normalizeCompanyName(name);
  const existing = await companiesRepository.findByNormalizedName(userId, normalizedName);
  if (existing) return existing;
  return companiesRepository.create(userId, {
    name: name.trim().replace(/\s+/g, ' '),
    normalizedName,
  });
}

export async function list(
  userId: string,
  query: { q?: string | undefined; page: number; limit: number },
): Promise<{ data: CompanyListItemView[]; meta: PageMeta }> {
  const { items, total } = await companiesRepository.list(userId, {
    page: query.page,
    limit: query.limit,
    ...(query.q !== undefined && { prefix: normalizeCompanyName(query.q) }),
  });
  const counts = await applicationsService.countsByCompany(
    userId,
    items.map((company) => company._id.toString()),
  );
  return {
    data: items.map((company) => ({
      ...toCompanyView(company),
      applicationCount: counts.get(company._id.toString()) ?? 0,
    })),
    meta: pageMeta(query.page, query.limit, total),
  };
}

export async function get(userId: string, id: string): Promise<CompanyDetailView> {
  const company = await getOwnedOrThrow(userId, id);
  const [applicationCount, contacts] = await Promise.all([
    applicationsService.countForCompany(userId, id),
    contactsService.listForCompany(userId, id),
  ]);
  return { ...toCompanyView(company), applicationCount, contacts };
}

export async function update(
  userId: string,
  id: string,
  input: UpdateCompanyInput,
): Promise<CompanyView> {
  const fields = {
    ...input,
    ...(input.name !== undefined && { normalizedName: normalizeCompanyName(input.name) }),
  };
  try {
    return await withTransaction(async () => {
      const company = await companiesRepository.updateOwned(userId, id, fields);
      if (!company) throw new NotFoundError('Company');
      // Applications keep a copy of the name for fast search/sort; keep it in step (ADR-007).
      if (input.name !== undefined) {
        await applicationsService.renameCompany(userId, id, company.name);
      }
      return toCompanyView(company);
    });
  } catch (err) {
    if (isDuplicateKeyError(err) && fields.normalizedName !== undefined) {
      throw await duplicateError(userId, fields.normalizedName);
    }
    throw err;
  }
}

export async function remove(userId: string, id: string): Promise<void> {
  await withTransaction(async () => {
    await getOwnedOrThrow(userId, id);
    const count = await applicationsService.countForCompany(userId, id);
    if (count > 0) {
      throw new ConflictError(
        'COMPANY_IN_USE',
        `This company is used by ${String(count)} application(s). Move or delete them first.`,
        { count },
      );
    }
    await contactsService.detachCompany(userId, id);
    await companiesRepository.deleteOwned(userId, id);
  });
}

export const { deleteAllForUser } = companiesRepository;

export async function exportAll(userId: string): Promise<CompanyView[]> {
  return (await companiesRepository.listAllForUser(userId)).map(toCompanyView);
}
