// Exports the user's own data: applications as CSV (with formula escaping) or everything as JSON
// (FR-020, FR-058). Only ever reads data scoped to the caller.
import { toCsv } from '../../lib/csv.ts';
import { formatLocalDate, localDateOf } from '../../lib/time.ts';
import * as activitiesService from '../activities/activities.service.ts';
import * as applicationsService from '../applications/applications.service.ts';
import type { ExportApplicationsQuery } from '../applications/applications.schemas.ts';
import * as companiesService from '../companies/companies.service.ts';
import * as contactsService from '../contacts/contacts.service.ts';
import { IMPORT_COLUMNS } from '../imports/imports.schemas.ts';
import * as remindersService from '../reminders/reminders.service.ts';
import * as usersService from '../users/users.service.ts';

const MAX_EXPORT_ROWS = 10_000;

// The import template's columns first, so an export can be re-imported elsewhere.
const CSV_HEADER = [...IMPORT_COLUMNS, 'id', 'nextFollowUpAt', 'archivedAt', 'createdAt'];

export async function applicationsCsv(
  userId: string,
  query: ExportApplicationsQuery,
): Promise<string> {
  const timezone = await usersService.getTimezone(userId);
  const apps = await applicationsService.exportList(userId, query, MAX_EXPORT_ROWS);
  return toCsv(
    CSV_HEADER,
    apps.map((app) => [
      app.companyName,
      app.title,
      app.status,
      app.appliedAt ? formatLocalDate(localDateOf(app.appliedAt, timezone)) : '',
      app.source,
      app.priority,
      app.location,
      app.workMode,
      app.employmentType,
      app.jobUrl,
      app.salary?.min,
      app.salary?.max,
      app.salary?.currency,
      app.salary?.period,
      app._id.toString(),
      app.nextFollowUpAt?.toISOString(),
      app.archivedAt?.toISOString(),
      app.createdAt.toISOString(),
    ]),
  );
}

export async function accountJson(userId: string): Promise<Record<string, unknown>> {
  const [profile, companies, contacts, applications, reminders, activities] = await Promise.all([
    usersService.getProfile(userId),
    companiesService.exportAll(userId),
    contactsService.exportAll(userId),
    applicationsService.exportAll(userId),
    remindersService.exportAll(userId),
    activitiesService.exportAll(userId),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    profile,
    companies,
    contacts,
    applications,
    reminders,
    activities,
  };
}
