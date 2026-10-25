// FR-021 to FR-034, BR-001 to BR-007, BR-030 to BR-034: applications end to end.
import { describe, expect, it } from 'vitest';
import { ActivityModel } from '../src/modules/activities/activities.model.ts';
import { ReminderModel } from '../src/modules/reminders/reminders.model.ts';
import { createApplication, data, errorCode, loggedInUser, moveTo, type App } from './helpers.ts';

interface ListResponse {
  data: (App & { interviewCount: number })[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
const list = (res: { body: unknown }) => res.body as ListResponse;
const titles = (res: { body: unknown }) => list(res).data.map((app) => app.title);

describe('create', () => {
  it('creates the company inline, sets the applied date and records a timeline event', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent, {
      companyName: 'Globex',
      title: 'SRE',
      source: 'referral',
    });
    expect(app).toMatchObject({
      companyName: 'Globex',
      title: 'SRE',
      status: 'applied',
      version: 0,
    });
    expect(app.appliedAt).not.toBeNull();
    expect(app.milestones.respondedAt).toBeNull();

    const timeline = await agent.get(`/api/v1/applications/${app.id}/activities`).expect(200);
    expect(data<{ type: string }[]>(timeline).map((a) => a.type)).toEqual(['created']);
  });

  it('reuses an existing company when the name matches', async () => {
    const { agent } = await loggedInUser();
    const first = await createApplication(agent, { companyName: 'Acme Corp' });
    const second = await createApplication(agent, {
      companyName: '  acme   CORP',
      title: 'Other role',
    });
    expect(second.companyId).toBe(first.companyId);
  });

  it('requires exactly one of companyId or companyName', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    await agent.post('/api/v1/applications').send({ title: 'No company' }).expect(400);
    await agent
      .post('/api/v1/applications')
      .send({ title: 'Both', companyId: app.companyId, companyName: 'Acme' })
      .expect(400);
  });

  it('leaves the applied date empty for saved jobs', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent, { status: 'saved' });
    expect(app.appliedAt).toBeNull();
  });

  it("reads a date-only applied date in the user's timezone", async () => {
    const { agent } = await loggedInUser({ timezone: 'Asia/Karachi' });
    const app = await createApplication(agent, { appliedAt: '2026-10-25' });
    expect(app.appliedAt).toBe('2026-10-24T19:00:00.000Z'); // local midnight, UTC+5
  });

  it('sets the implied milestones when created directly at a later status (BR-007)', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent, { status: 'offer' });
    expect(app.milestones.respondedAt).not.toBeNull();
    expect(app.milestones.interviewAt).not.toBeNull();
    expect(app.milestones.offerAt).not.toBeNull();
    expect(app.milestones.closedAt).toBeNull();
  });
});

describe('list, search, filter, sort, paginate', () => {
  it('filters by status and searches company or title, case-insensitively', async () => {
    const { agent } = await loggedInUser();
    await createApplication(agent, { companyName: 'Acme', title: 'Backend Engineer' });
    await createApplication(agent, {
      companyName: 'Globex',
      title: 'Frontend Engineer',
      status: 'saved',
    });
    await createApplication(agent, { companyName: 'Backend Labs', title: 'Designer' });

    expect(titles(await agent.get('/api/v1/applications?status=saved').expect(200))).toEqual([
      'Frontend Engineer',
    ]);
    const search = titles(await agent.get('/api/v1/applications?q=BACKEND').expect(200));
    expect(search.sort()).toEqual(['Backend Engineer', 'Designer']);
    // Regex characters are matched literally, not as a pattern.
    expect(list(await agent.get('/api/v1/applications?q=.*').expect(200)).data).toHaveLength(0);
  });

  it('paginates with correct metadata and returns an empty page past the end', async () => {
    const { agent } = await loggedInUser();
    for (let i = 1; i <= 5; i++) await createApplication(agent, { title: `Role ${String(i)}` });

    const page2 = list(await agent.get('/api/v1/applications?limit=2&page=2').expect(200));
    expect(page2.data).toHaveLength(2);
    expect(page2.meta).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3 });

    const beyond = list(await agent.get('/api/v1/applications?limit=2&page=9').expect(200));
    expect(beyond.data).toEqual([]);
    expect(beyond.meta.total).toBe(5);
  });

  it('rejects invalid paging, sorting and filter values instead of guessing', async () => {
    const { agent } = await loggedInUser();
    await agent.get('/api/v1/applications?limit=101').expect(400);
    await agent.get('/api/v1/applications?page=0').expect(400);
    await agent.get('/api/v1/applications?sort=salary').expect(400);
    await agent.get('/api/v1/applications?status=hired').expect(400);
    await agent.get('/api/v1/applications?appliedFrom=2026-02-30').expect(400);
  });

  it('sorts by follow-up date with empty values last, in both directions', async () => {
    const { agent } = await loggedInUser();
    const none = await createApplication(agent, { title: 'No follow-up' });
    const later = await createApplication(agent, { title: 'Later' });
    const sooner = await createApplication(agent, { title: 'Sooner' });
    const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    await agent
      .post('/api/v1/reminders')
      .send({ title: 'x', dueAt: inHours(48), applicationId: later.id })
      .expect(201);
    await agent
      .post('/api/v1/reminders')
      .send({ title: 'x', dueAt: inHours(24), applicationId: sooner.id })
      .expect(201);

    expect(
      titles(await agent.get('/api/v1/applications?sort=nextFollowUpAt&order=asc').expect(200)),
    ).toEqual(['Sooner', 'Later', none.title]);
    expect(
      titles(await agent.get('/api/v1/applications?sort=nextFollowUpAt&order=desc').expect(200)),
    ).toEqual(['Later', 'Sooner', none.title]);
  });

  it('filters by applied date range, inclusive of both ends', async () => {
    const { agent } = await loggedInUser();
    await createApplication(agent, { title: 'Oct 1', appliedAt: '2026-10-01' });
    await createApplication(agent, { title: 'Oct 15', appliedAt: '2026-10-15' });
    await createApplication(agent, { title: 'Oct 31', appliedAt: '2026-10-31' });
    const res = await agent.get(
      '/api/v1/applications?appliedFrom=2026-10-01&appliedTo=2026-10-15&sort=appliedAt&order=asc',
    );
    expect(titles(res)).toEqual(['Oct 1', 'Oct 15']);
  });
});

describe('edit with optimistic concurrency (FR-025)', () => {
  it('updates fields and bumps the version', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    const res = await agent
      .patch(`/api/v1/applications/${app.id}`)
      .send({
        version: 0,
        title: 'Staff Engineer',
        salary: { min: 90000, max: 120000, currency: 'EUR', period: 'year' },
      })
      .expect(200);
    expect(data<App>(res)).toMatchObject({ title: 'Staff Engineer', version: 1 });
  });

  it('rejects a stale version with 409 CONFLICT', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    await agent
      .patch(`/api/v1/applications/${app.id}`)
      .send({ version: 0, title: 'First' })
      .expect(200);
    const res = await agent
      .patch(`/api/v1/applications/${app.id}`)
      .send({ version: 0, title: 'Second' })
      .expect(409);
    expect(errorCode(res)).toBe('CONFLICT');
  });

  it('cannot change status, milestones or server-owned fields through PATCH (mass assignment)', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    await agent
      .patch(`/api/v1/applications/${app.id}`)
      .send({ version: 0, status: 'offer' })
      .expect(400);
    await agent
      .patch(`/api/v1/applications/${app.id}`)
      .send({ version: 0, nextFollowUpAt: null })
      .expect(400);
    await agent
      .patch(`/api/v1/applications/${app.id}`)
      .send({ version: 0, salary: { min: 5, max: 1, currency: 'EUR', period: 'year' } })
      .expect(400);
  });

  it('keeps an applied date once past saved', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    await agent
      .patch(`/api/v1/applications/${app.id}`)
      .send({ version: 0, appliedAt: null })
      .expect(400);
  });
});

describe('status machine over HTTP (FR-027, FR-028)', () => {
  it('moves through valid transitions, setting milestones and timeline events', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    const screened = await moveTo(agent, app.id, 'screening');
    expect(screened.milestones.respondedAt).not.toBeNull();
    expect(screened.milestones.screeningAt).not.toBeNull();

    const timeline = data<{ type: string; data: { from?: string; to?: string } }[]>(
      await agent.get(`/api/v1/applications/${app.id}/activities`).expect(200),
    );
    expect(timeline[0]).toMatchObject({
      type: 'status_changed',
      data: { from: 'applied', to: 'screening' },
    });
  });

  it('rejects an invalid transition with the allowed targets', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent, { status: 'saved' });
    const res = await agent
      .post(`/api/v1/applications/${app.id}/status`)
      .send({ to: 'offer', version: 0 })
      .expect(409);
    expect(res.body).toMatchObject({
      error: {
        code: 'INVALID_STATUS_TRANSITION',
        details: { from: 'saved', to: 'offer', allowed: ['applied', 'withdrawn'] },
      },
    });
  });

  it('rejects a status change based on a stale version', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    await agent
      .patch(`/api/v1/applications/${app.id}`)
      .send({ version: 0, title: 'Edited' })
      .expect(200);
    const res = await agent
      .post(`/api/v1/applications/${app.id}/status`)
      .send({ to: 'screening', version: 0 })
      .expect(409);
    expect(res.body).toMatchObject({ error: { code: 'CONFLICT', details: { currentVersion: 1 } } });
  });

  it('treats a same-status request as invalid (BR-002)', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    await agent
      .post(`/api/v1/applications/${app.id}/status`)
      .send({ to: 'applied', version: 0 })
      .expect(409);
  });

  it('reopens a rejection to the previous status, keeping milestones (BR-003, BR-005)', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    await moveTo(agent, app.id, 'interview', 'rejected');
    const reopened = await moveTo(agent, app.id, 'interview');
    expect(reopened.status).toBe('interview');
    expect(reopened.milestones.closedAt).not.toBeNull();

    const timeline = data<{ type: string }[]>(
      await agent.get(`/api/v1/applications/${app.id}/activities`).expect(200),
    );
    expect(timeline[0]?.type).toBe('reopened');
  });

  it('sets the applied date when a saved job is applied to', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent, { status: 'saved' });
    const applied = data<App>(
      await agent
        .post(`/api/v1/applications/${app.id}/status`)
        .send({ to: 'applied', version: 0, appliedAt: '2026-10-20' })
        .expect(200),
    );
    expect(applied.appliedAt).toBe('2026-10-20T00:00:00.000Z');
  });

  it('lets exactly one of two simultaneous transitions win (BR-004)', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    const results = await Promise.all([
      agent.post(`/api/v1/applications/${app.id}/status`).send({ to: 'screening', version: 0 }),
      agent.post(`/api/v1/applications/${app.id}/status`).send({ to: 'rejected', version: 0 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    // Both saw version 0; the loser is told to reload rather than applied to a state it never saw.
    expect(errorCode(results.find((r) => r.status === 409) ?? { body: {} })).toBe('CONFLICT');
    const events = await ActivityModel.countDocuments({
      applicationId: app.id,
      type: 'status_changed',
    });
    expect(events).toBe(1);
  });
});

describe('archive, notes, interviews, contacts, delete', () => {
  it('archives out of the default list and restores, idempotently', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    await agent.post(`/api/v1/applications/${app.id}/archive`).expect(200);
    await agent.post(`/api/v1/applications/${app.id}/archive`).expect(200);
    expect(list(await agent.get('/api/v1/applications').expect(200)).data).toHaveLength(0);
    expect(
      list(await agent.get('/api/v1/applications?archived=only').expect(200)).data,
    ).toHaveLength(1);
    expect(await ActivityModel.countDocuments({ applicationId: app.id, type: 'archived' })).toBe(1);

    await agent.post(`/api/v1/applications/${app.id}/restore`).expect(200);
    expect(list(await agent.get('/api/v1/applications').expect(200)).data).toHaveLength(1);
  });

  it('adds, edits and deletes notes', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    const note = data<{ id: string }>(
      await agent
        .post(`/api/v1/applications/${app.id}/notes`)
        .send({ body: 'Ask about on-call' })
        .expect(201),
    );
    const edited = await agent
      .patch(`/api/v1/applications/${app.id}/notes/${note.id}`)
      .send({ body: 'Asked' })
      .expect(200);
    expect(data<{ data: { body: string } }>(edited).data.body).toBe('Asked');
    await agent.delete(`/api/v1/applications/${app.id}/notes/${note.id}`).expect(204);
    await agent.delete(`/api/v1/applications/${app.id}/notes/${note.id}`).expect(404);
  });

  it('cannot edit a system timeline event as if it were a note', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    const created = await ActivityModel.findOne({ applicationId: app.id, type: 'created' }).lean();
    await agent
      .patch(`/api/v1/applications/${app.id}/notes/${created?._id.toString() ?? ''}`)
      .send({ body: 'rewrite history' })
      .expect(404);
  });

  it('manages interview rounds, capped at 20', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    const withRound = data<App>(
      await agent
        .post(`/api/v1/applications/${app.id}/interviews`)
        .send({
          round: 1,
          type: 'phone_screen',
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .expect(201),
    );
    const interviewId = withRound.interviews[0]?.id ?? '';
    const passed = data<App>(
      await agent
        .patch(`/api/v1/applications/${app.id}/interviews/${interviewId}`)
        .send({ outcome: 'passed' })
        .expect(200),
    );
    expect(passed.interviews[0]?.outcome).toBe('passed');

    for (let round = 2; round <= 20; round++) {
      await agent
        .post(`/api/v1/applications/${app.id}/interviews`)
        .send({ round, type: 'technical' })
        .expect(201);
    }
    const full = await agent
      .post(`/api/v1/applications/${app.id}/interviews`)
      .send({ round: 21, type: 'final' })
      .expect(409);
    expect(errorCode(full)).toBe('TOO_MANY_INTERVIEWS');

    await agent.delete(`/api/v1/applications/${app.id}/interviews/${interviewId}`).expect(200);
  });

  it('shows linked contacts and pending reminders on the detail view', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    const contact = data<{ id: string }>(
      await agent.post('/api/v1/contacts').send({ name: 'Jane' }).expect(201),
    );
    await agent
      .put(`/api/v1/applications/${app.id}/contacts`)
      .send({ contactIds: [contact.id, contact.id] })
      .expect(200);
    await agent
      .post('/api/v1/reminders')
      .send({
        title: 'Follow up',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        applicationId: app.id,
      })
      .expect(201);

    const detail = await agent.get(`/api/v1/applications/${app.id}`).expect(200);
    expect(detail.body).toMatchObject({
      data: {
        contactIds: [contact.id],
        contacts: [{ name: 'Jane' }],
        pendingReminders: [{ title: 'Follow up' }],
      },
    });
  });

  it('deletes the application together with its timeline and reminders', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    await agent
      .post('/api/v1/reminders')
      .send({
        title: 'x',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        applicationId: app.id,
      })
      .expect(201);

    await agent.delete(`/api/v1/applications/${app.id}`).expect(204);
    await agent.get(`/api/v1/applications/${app.id}`).expect(404);
    expect(await ActivityModel.countDocuments({ applicationId: app.id })).toBe(0);
    expect(await ReminderModel.countDocuments({ applicationId: app.id })).toBe(0);
  });

  it('rejects malformed ids with 400 and unknown ids with 404', async () => {
    const { agent } = await loggedInUser();
    await agent.get('/api/v1/applications/not-an-id').expect(400);
    await agent.get('/api/v1/applications/6720f1c2a1b2c3d4e5f60718').expect(404);
  });
});
