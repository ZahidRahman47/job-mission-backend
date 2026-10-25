// NFR-009, US-06, threat T1: user B must not be able to read, change or delete anything of
// user A's, whether the id is in the URL or hidden in the request body. Every case must be a
// 404 (not 403), so B can't even learn that the id exists.
import { beforeEach, describe, expect, it } from 'vitest';
import { createApplication, data, loggedInUser, type Agent, type App } from './helpers.ts';

let alice: { agent: Agent };
let bob: { agent: Agent };
let ids: {
  app: string;
  company: string;
  contact: string;
  note: string;
  interview: string;
  reminder: string;
  importReport: string;
};
let appBefore: App;

beforeEach(async () => {
  alice = await loggedInUser();
  bob = await loggedInUser();
  const a = alice.agent;

  const app = await createApplication(a, { companyName: 'Alice Co' });
  const contact = data<{ id: string }>(
    await a.post('/api/v1/contacts').send({ name: 'Alice Contact' }).expect(201),
  );
  const note = data<{ id: string }>(
    await a.post(`/api/v1/applications/${app.id}/notes`).send({ body: 'private' }).expect(201),
  );
  const withInterview = data<App>(
    await a
      .post(`/api/v1/applications/${app.id}/interviews`)
      .send({ round: 1, type: 'technical' })
      .expect(201),
  );
  const reminder = data<{ id: string }>(
    await a
      .post('/api/v1/reminders')
      .send({
        title: 'x',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        applicationId: app.id,
      })
      .expect(201),
  );
  const report = data<{ id: string }>(
    await a
      .post('/api/v1/imports/applications')
      .set('Content-Type', 'text/csv')
      .send('company,title\nAcme,Role')
      .expect(201),
  );

  ids = {
    app: app.id,
    company: app.companyId,
    contact: contact.id,
    note: note.id,
    interview: withInterview.interviews[0]?.id ?? '',
    reminder: reminder.id,
    importReport: report.id,
  };
  appBefore = data<App>(await a.get(`/api/v1/applications/${app.id}`).expect(200));
});

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

function urlCases(): [Method, string, Record<string, unknown>?][] {
  return [
    ['get', `/applications/${ids.app}`],
    ['patch', `/applications/${ids.app}`, { version: 0, title: 'pwned' }],
    ['delete', `/applications/${ids.app}`],
    ['post', `/applications/${ids.app}/status`, { to: 'rejected', version: 0 }],
    ['post', `/applications/${ids.app}/archive`],
    ['post', `/applications/${ids.app}/restore`],
    ['get', `/applications/${ids.app}/activities`],
    ['post', `/applications/${ids.app}/notes`, { body: 'x' }],
    ['patch', `/applications/${ids.app}/notes/${ids.note}`, { body: 'x' }],
    ['delete', `/applications/${ids.app}/notes/${ids.note}`],
    ['post', `/applications/${ids.app}/interviews`, { round: 2, type: 'final' }],
    ['patch', `/applications/${ids.app}/interviews/${ids.interview}`, { outcome: 'failed' }],
    ['delete', `/applications/${ids.app}/interviews/${ids.interview}`],
    ['put', `/applications/${ids.app}/contacts`, { contactIds: [] }],
    ['get', `/companies/${ids.company}`],
    ['patch', `/companies/${ids.company}`, { name: 'pwned' }],
    ['delete', `/companies/${ids.company}`],
    ['get', `/contacts/${ids.contact}`],
    ['patch', `/contacts/${ids.contact}`, { name: 'pwned' }],
    ['delete', `/contacts/${ids.contact}`],
    ['get', `/contacts/${ids.contact}/interactions`],
    ['post', `/contacts/${ids.contact}/interactions`, { channel: 'call', summary: 'x' }],
    ['get', `/reminders/${ids.reminder}`],
    ['patch', `/reminders/${ids.reminder}`, { title: 'pwned' }],
    ['post', `/reminders/${ids.reminder}/complete`],
    ['post', `/reminders/${ids.reminder}/reopen`],
    ['delete', `/reminders/${ids.reminder}`],
    ['get', `/imports/${ids.importReport}`],
  ];
}

describe("another user's ids in the URL", () => {
  it('every route returns 404 and changes nothing', async () => {
    for (const [method, path, body] of urlCases()) {
      const res = await bob.agent[method](`/api/v1${path}`).send(body ?? {});
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
    }

    // Alice's data is exactly as before.
    const after = data<App>(await alice.agent.get(`/api/v1/applications/${ids.app}`).expect(200));
    expect(after).toEqual(appBefore);
    await alice.agent.get(`/api/v1/contacts/${ids.contact}`).expect(200);
    await alice.agent.get(`/api/v1/reminders/${ids.reminder}`).expect(200);
  });
});

describe("another user's ids hidden in the request body", () => {
  it('cannot attach to, or create inside, data that is not mine', async () => {
    const own = await createApplication(bob.agent, { companyName: 'Bob Co' });
    const ownContact = data<{ id: string }>(
      await bob.agent.post('/api/v1/contacts').send({ name: 'Bob Contact' }).expect(201),
    );

    const cases: [Method, string, Record<string, unknown>][] = [
      ['post', '/applications', { companyId: ids.company, title: 'x' }],
      ['patch', `/applications/${own.id}`, { version: own.version, companyId: ids.company }],
      ['put', `/applications/${own.id}/contacts`, { contactIds: [ids.contact] }],
      ['post', '/contacts', { name: 'x', companyId: ids.company }],
      ['patch', `/contacts/${ownContact.id}`, { companyId: ids.company }],
      [
        'post',
        `/contacts/${ownContact.id}/interactions`,
        { channel: 'call', summary: 'x', applicationId: ids.app },
      ],
      [
        'post',
        '/reminders',
        {
          title: 'x',
          dueAt: new Date(Date.now() + 86_400_000).toISOString(),
          applicationId: ids.app,
        },
      ],
    ];
    for (const [method, path, body] of cases) {
      const res = await bob.agent[method](`/api/v1${path}`).send(body);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
    }
  });
});

describe('lists, search, analytics and exports', () => {
  it("never include another user's records", async () => {
    const lists = [
      '/applications?archived=include',
      '/companies',
      '/contacts',
      '/reminders?view=upcoming',
      '/activities',
    ];
    for (const path of lists) {
      const res = await bob.agent.get(`/api/v1${path}`).expect(200);
      expect((res.body as { data: unknown[] }).data, path).toEqual([]);
    }
    const summary = data<{ total: number }>(
      await bob.agent.get('/api/v1/analytics/summary').expect(200),
    );
    expect(summary.total).toBe(0);
    const csv = await bob.agent.get('/api/v1/exports/applications.csv').expect(200);
    expect(csv.text).not.toContain('Alice Co');
  });
});
