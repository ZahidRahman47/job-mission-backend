// CSV import: parse, validate each row, skip duplicates, create companies as needed, insert in
// batches, and keep a report (FR-055 to FR-057). One bad row never blocks the good ones.
import { toCsv, parseCsv } from '../../lib/csv.ts';
import { NotFoundError, ValidationError } from '../../lib/errors.ts';
import { formatLocalDate, localDateOf, parseLocalDate, zonedMidnight } from '../../lib/time.ts';
import * as activitiesService from '../activities/activities.service.ts';
import * as applicationsService from '../applications/applications.service.ts';
import { initialMilestones } from '../applications/status-machine.ts';
import * as companiesService from '../companies/companies.service.ts';
import { normalizeCompanyName } from '../companies/companies.service.ts';
import * as usersService from '../users/users.service.ts';
import type { ImportReportRecord } from './import-report.model.ts';
import * as importReportRepository from './import-report.repository.ts';
import {
  IMPORT_COLUMNS,
  importRowSchema,
  REQUIRED_IMPORT_COLUMNS,
  type ImportReportView,
  type ImportRow,
} from './imports.schemas.ts';

const MAX_ROWS = 5000;
const MAX_STORED_ERRORS = 500;
const BATCH_SIZE = 500;

export function templateCsv(): string {
  return toCsv(
    [...IMPORT_COLUMNS],
    [
      [
        'Acme Corp',
        'Senior Backend Engineer',
        'applied',
        '2026-10-01',
        'linkedin',
        'high',
        'Berlin',
        'hybrid',
        'full_time',
        'https://jobs.acme.example/123',
        70000,
        85000,
        'EUR',
        'year',
      ],
      [
        'Globex',
        'Platform Engineer',
        'saved',
        '',
        'company_site',
        'medium',
        'Remote',
        'remote',
        'contract',
        '',
        '',
        '',
        '',
        '',
      ],
    ],
  );
}

function toReportView(report: ImportReportRecord): ImportReportView {
  return {
    id: report._id.toString(),
    fileName: report.fileName ?? null,
    totals: {
      rows: report.totals?.rows ?? 0,
      created: report.totals?.created ?? 0,
      skipped: report.totals?.skipped ?? 0,
      failed: report.totals?.failed ?? 0,
    },
    errors: report.rowErrors.map((error) => ({
      row: error.row ?? 0,
      column: error.column ?? '',
      message: error.message ?? '',
    })),
    createdAt: report.createdAt.toISOString(),
  };
}

// Same job at the same company on the same day = the same application (FR-057).
function duplicateKey(company: string, title: string, appliedDay: string): string {
  return `${normalizeCompanyName(company)}|${title.trim().toLowerCase()}|${appliedDay}`;
}

export async function importApplications(
  userId: string,
  csvText: string,
  fileName: string | null,
): Promise<ImportReportView> {
  if (csvText.trim() === '') {
    throw new ValidationError([{ location: 'body', path: [], message: 'The file is empty.' }]);
  }
  const { header, rows } = parseCsv(csvText);
  const missing = REQUIRED_IMPORT_COLUMNS.filter(
    (column) => !header.includes(column.toLowerCase()),
  );
  if (missing.length > 0) {
    throw new ValidationError([
      { location: 'body', path: [], message: `Missing required column(s): ${missing.join(', ')}.` },
    ]);
  }
  if (rows.length > MAX_ROWS) {
    throw new ValidationError([
      {
        location: 'body',
        path: [],
        message: `At most ${String(MAX_ROWS)} rows per file (got ${String(rows.length)}).`,
      },
    ]);
  }

  const timezone = await usersService.getTimezone(userId);
  const now = new Date();
  const seen = new Set(
    (await applicationsService.listImportKeySources(userId)).map((app) =>
      duplicateKey(
        app.companyName,
        app.title,
        app.appliedAt ? formatLocalDate(localDateOf(app.appliedAt, timezone)) : '',
      ),
    ),
  );

  const rowErrors: { row: number; column: string; message: string }[] = [];
  const accepted: { row: ImportRow; appliedAt: Date | null }[] = [];
  let failed = 0;
  let skipped = 0;

  rows.forEach((raw, index) => {
    const rowNumber = index + 2; // the header is row 1
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      failed++;
      for (const issue of parsed.error.issues) {
        if (rowErrors.length < MAX_STORED_ERRORS) {
          rowErrors.push({
            row: rowNumber,
            column: String(issue.path[0] ?? ''),
            message: issue.message,
          });
        }
      }
      return;
    }
    const row = parsed.data;
    const appliedAt = row.appliedat
      ? zonedMidnight(parseLocalDate(row.appliedat), timezone)
      : row.status === 'saved'
        ? null
        : now;
    const key = duplicateKey(
      row.company,
      row.title,
      appliedAt ? formatLocalDate(localDateOf(appliedAt, timezone)) : '',
    );
    if (seen.has(key)) {
      skipped++;
      return;
    }
    seen.add(key);
    accepted.push({ row, appliedAt });
  });

  // One company per distinct name, reused across rows and with existing companies.
  const companies = new Map<
    string,
    Awaited<ReturnType<typeof companiesService.findOrCreateByName>>
  >();
  for (const { row } of accepted) {
    const key = normalizeCompanyName(row.company);
    if (!companies.has(key))
      companies.set(key, await companiesService.findOrCreateByName(userId, row.company));
  }

  let created = 0;
  for (let start = 0; start < accepted.length; start += BATCH_SIZE) {
    const batch = accepted.slice(start, start + BATCH_SIZE).map(({ row, appliedAt }) => {
      const company = companies.get(normalizeCompanyName(row.company));
      if (!company) throw new Error('Company missing for import row');
      return {
        userId: company.userId,
        companyId: company._id,
        companyName: company.name,
        title: row.title,
        jobDescription: null,
        location: row.location ?? null,
        workMode: row.workmode ?? null,
        employmentType: row.employmenttype ?? null,
        salary:
          row.salarycurrency && row.salaryperiod
            ? {
                min: row.salarymin ?? null,
                max: row.salarymax ?? null,
                currency: row.salarycurrency,
                period: row.salaryperiod,
              }
            : null,
        jobUrl: row.joburl ?? null,
        source: row.source,
        priority: row.priority,
        status: row.status,
        appliedAt,
        milestones: initialMilestones(row.status, appliedAt ?? now),
      };
    });
    const inserted = await applicationsService.insertMany(batch);
    created += inserted.length;
    await activitiesService.recordMany(
      inserted.map((app) => ({
        userId,
        type: 'created' as const,
        applicationId: app._id.toString(),
        data: {
          status: app.status,
          via: 'csv_import',
          applicationTitle: app.title,
          companyName: app.companyName,
        },
      })),
    );
  }

  const report = await importReportRepository.create({
    userId,
    fileName,
    totals: { rows: rows.length, created, skipped, failed },
    rowErrors,
  });
  return toReportView(report);
}

export async function getReport(userId: string, id: string): Promise<ImportReportView> {
  const report = await importReportRepository.findOwned(userId, id);
  if (!report) throw new NotFoundError('Import report');
  return toReportView(report);
}

export const { deleteAllForUser } = importReportRepository;
