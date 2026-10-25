// FR-020, FR-055 to FR-058, US-09, US-10: CSV import/export, JSON export, full account deletion.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { ActivityModel } from '../src/modules/activities/activities.model.ts';
import { ApplicationModel } from '../src/modules/applications/applications.model.ts';
import { CompanyModel } from '../src/modules/companies/companies.model.ts';
import { ContactModel } from '../src/modules/contacts/contacts.model.ts';
import { ImportReportModel } from '../src/modules/imports/import-report.model.ts';
import { ReminderModel } from '../src/modules/reminders/reminders.model.ts';
import { createApplication, data, errorCode, loggedInUser, type Agent } from './helpers.ts';

interface Report {
  id: string;
  totals: { rows: number; created: number; skipped: number; failed: number };
  errors: { row: number; column: string; message: string }[];
}

const HEADER = 'company,title,status,appliedAt,source,priority';

// 100 data rows across 5 companies; file rows 7 and 42 have an impossible date.
function sampleCsv(): string {
  const lines = [HEADER];
  for (let i = 1; i <= 100; i++) {
    const fileRow = i + 1;
    const date = fileRow === 7 || fileRow === 42 ? '2026-02-30' : '2026-09-15';
    lines.push(`Company ${String(i % 5)},Role ${String(i)},applied,${date},linkedin,medium`);
  }
  return lines.join('\n');
}

async function importCsv(agent: Agent, csv: string, expectStatus = 201) {
  return agent
    .post('/api/v1/imports/applications?fileName=jobs.csv')
    .set('Content-Type', 'text/csv')
    .send(csv)
    .expect(expectStatus);
}

describe('CSV import', () => {
  it('serves a template with the documented columns', async () => {
    const { agent } = await loggedInUser();
    const res = await agent.get('/api/v1/imports/applications/template').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.text.split('\n')[0]).toBe(
      'company,title,status,appliedAt,source,priority,location,workMode,employmentType,jobUrl,salaryMin,salaryMax,salaryCurrency,salaryPeriod',
    );
  });

  it('imports valid rows, reports bad rows by number and creates each company once (US-09)', async () => {
    const { agent, userId } = await loggedInUser();
    const report = data<Report>(await importCsv(agent, sampleCsv()));

    expect(report.totals).toEqual({ rows: 100, created: 98, skipped: 0, failed: 2 });
    expect(report.errors.map((e) => [e.row, e.column])).toEqual([
      [7, 'appliedat'],
      [42, 'appliedat'],
    ]);
    expect(await CompanyModel.countDocuments({ userId })).toBe(5);
    expect(await ActivityModel.countDocuments({ userId, type: 'created' })).toBe(98);

    const stored = await agent.get(`/api/v1/imports/${report.id}`).expect(200);
    expect(data<Report>(stored).totals.created).toBe(98);
  });

  it('skips duplicates when the same file is imported again', async () => {
    const { agent, userId } = await loggedInUser();
    await importCsv(agent, sampleCsv());
    const again = data<Report>(await importCsv(agent, sampleCsv()));
    expect(again.totals).toEqual({ rows: 100, created: 0, skipped: 98, failed: 2 });
    expect(await ApplicationModel.countDocuments({ userId })).toBe(98);
  });

  it('rejects files that are too large, the wrong type, malformed or missing columns', async () => {
    const { agent } = await loggedInUser();
    const huge = `${HEADER}\n${'Acme,Role,applied,2026-09-15,linkedin,medium\n'.repeat(130_000)}`;
    expect(errorCode(await importCsv(agent, huge, 413))).toBe('PAYLOAD_TOO_LARGE');

    const json = await agent
      .post('/api/v1/imports/applications')
      .send({ company: 'Acme' })
      .expect(415);
    expect(errorCode(json)).toBe('UNSUPPORTED_MEDIA_TYPE');

    await importCsv(agent, 'company,title\n"Acme,Unclosed quote', 400);
    await importCsv(agent, 'name,role\nAcme,Engineer', 400);
    await importCsv(agent, '   ', 400);
  });
});

describe('exports', () => {
  it('exports applications as CSV, applying filters and escaping formulas (T11)', async () => {
    const { agent } = await loggedInUser();
    await createApplication(agent, { title: '=HYPERLINK("http://evil.example","click")' });
    await createApplication(agent, { title: 'Saved only', status: 'saved' });

    const res = await agent.get('/api/v1/exports/applications.csv?status=applied').expect(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="?mission-control-applications-\d{4}-\d{2}-\d{2}\.csv"?$/,
    );
    expect(res.text).toContain(`'=HYPERLINK`);
    expect(res.text).not.toContain('Saved only');
  });

  it("exports all of my data as JSON and nobody else's", async () => {
    const alice = await loggedInUser();
    const bob = await loggedInUser();
    await createApplication(alice.agent, { companyName: 'Alice Co' });
    await createApplication(bob.agent, { companyName: 'Bob Co' });

    const res = await alice.agent.get('/api/v1/exports/account.json').expect(200);
    const body = res.body as {
      profile: { email: string };
      applications: unknown[];
      companies: { name: string }[];
    };
    expect(body.profile.email).toBe(alice.email);
    expect(body.applications).toHaveLength(1);
    expect(body.companies.map((c) => c.name)).toEqual(['Alice Co']);
    expect(JSON.stringify(body)).not.toContain('Bob Co');
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|tokenHash/);
  });
});

describe('account deletion removes product data too (US-10)', () => {
  it('leaves zero documents with my userId in every collection', async () => {
    const { agent, password, userId } = await loggedInUser();
    const app = await createApplication(agent);
    await agent
      .post('/api/v1/contacts')
      .send({ name: 'Jane', companyId: app.companyId })
      .expect(201);
    await agent
      .post('/api/v1/reminders')
      .send({
        title: 'x',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        applicationId: app.id,
      })
      .expect(201);
    await importCsv(agent, `${HEADER}\nGlobex,SRE,applied,2026-09-15,linkedin,medium`);

    await agent.delete('/api/v1/users/me').send({ password }).expect(204);

    // Count straight from the database collections, bypassing the models.
    for (const model of [
      ApplicationModel,
      CompanyModel,
      ContactModel,
      ReminderModel,
      ActivityModel,
      ImportReportModel,
    ]) {
      const remaining = await model.collection.countDocuments({
        userId: new Types.ObjectId(userId),
      });
      expect(remaining, model.collection.collectionName).toBe(0);
    }
  });
});
