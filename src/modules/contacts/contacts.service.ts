// Contact rules: company ownership check, unlink from applications on delete, interaction log
// (FR-039, FR-040).
import { withTransaction } from '../../db/transaction.ts';
import { NotFoundError } from '../../lib/errors.ts';
import { pageMeta, type PageMeta } from '../../lib/pagination.ts';
import * as activitiesService from '../activities/activities.service.ts';
import type { ActivityView } from '../activities/activities.schemas.ts';
import * as applicationsService from '../applications/applications.service.ts';
import * as companiesService from '../companies/companies.service.ts';
import type { ContactRecord } from './contacts.model.ts';
import * as contactsRepository from './contacts.repository.ts';
import type {
  ContactView,
  CreateContactInput,
  InteractionInput,
  UpdateContactInput,
} from './contacts.schemas.ts';

export function toContactView(contact: ContactRecord): ContactView {
  return {
    id: contact._id.toString(),
    companyId: contact.companyId?.toString() ?? null,
    name: contact.name,
    title: contact.title ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    linkedinUrl: contact.linkedinUrl ?? null,
    notes: contact.notes ?? null,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

async function getOwnedOrThrow(userId: string, id: string): Promise<ContactRecord> {
  const contact = await contactsRepository.findOwned(userId, id);
  if (!contact) throw new NotFoundError('Contact');
  return contact;
}

// A companyId in the body must belong to the caller too, or it's an IDOR via the body (NFR-009).
async function assertCompanyOwned(userId: string, companyId: string | null | undefined) {
  if (companyId) await companiesService.getOwnedOrThrow(userId, companyId);
}

export async function create(userId: string, input: CreateContactInput): Promise<ContactView> {
  await assertCompanyOwned(userId, input.companyId);
  return toContactView(await contactsRepository.create(userId, input));
}

export async function list(
  userId: string,
  query: { q?: string | undefined; companyId?: string | undefined; page: number; limit: number },
): Promise<{ data: ContactView[]; meta: PageMeta }> {
  const { items, total } = await contactsRepository.list(userId, {
    page: query.page,
    limit: query.limit,
    ...(query.q !== undefined && { q: query.q }),
    ...(query.companyId !== undefined && { companyId: query.companyId }),
  });
  return { data: items.map(toContactView), meta: pageMeta(query.page, query.limit, total) };
}

export async function get(userId: string, id: string): Promise<ContactView> {
  return toContactView(await getOwnedOrThrow(userId, id));
}

export async function update(
  userId: string,
  id: string,
  input: UpdateContactInput,
): Promise<ContactView> {
  await assertCompanyOwned(userId, input.companyId);
  const contact = await contactsRepository.updateOwned(userId, id, input);
  if (!contact) throw new NotFoundError('Contact');
  return toContactView(contact);
}

// Interaction history is kept (with the contact's name as a snapshot); the contact is unlinked
// from applications (BR-021).
export async function remove(userId: string, id: string): Promise<void> {
  await withTransaction(async () => {
    if (!(await contactsRepository.deleteOwned(userId, id))) throw new NotFoundError('Contact');
    await applicationsService.unlinkContact(userId, id);
  });
}

export async function addInteraction(
  userId: string,
  contactId: string,
  input: InteractionInput,
): Promise<ActivityView> {
  const contact = await getOwnedOrThrow(userId, contactId);
  const application =
    input.applicationId === undefined
      ? undefined
      : await applicationsService.getSummaryOrThrow(userId, input.applicationId);

  return activitiesService.record({
    userId,
    type: 'contact_interaction',
    contactId,
    applicationId: application?.id ?? null,
    occurredAt: input.occurredAt ?? new Date(),
    data: {
      channel: input.channel,
      summary: input.summary,
      contactName: contact.name,
      ...(application && {
        applicationTitle: application.title,
        companyName: application.companyName,
      }),
    },
  });
}

export async function listInteractions(
  userId: string,
  contactId: string,
  cursor: string | undefined,
  limit: number,
) {
  await getOwnedOrThrow(userId, contactId);
  return activitiesService.listForContact(userId, contactId, cursor, limit);
}

// --- used by other modules -------------------------------------------------------------------

export async function listForCompany(
  userId: string,
  companyId: string,
): Promise<{ id: string; name: string; title: string | null }[]> {
  return (await contactsRepository.listForCompany(userId, companyId)).map((contact) => ({
    id: contact._id.toString(),
    name: contact.name,
    title: contact.title ?? null,
  }));
}

export async function assertAllOwned(userId: string, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if ((await contactsRepository.countOwned(userId, unique)) !== unique.length) {
    throw new NotFoundError('Contact');
  }
}

export async function listByIds(userId: string, ids: string[]): Promise<ContactView[]> {
  if (ids.length === 0) return [];
  return (await contactsRepository.listByIds(userId, ids)).map(toContactView);
}

export const { detachCompany, deleteAllForUser } = contactsRepository;

export async function exportAll(userId: string): Promise<ContactView[]> {
  return (await contactsRepository.listAllForUser(userId)).map(toContactView);
}
