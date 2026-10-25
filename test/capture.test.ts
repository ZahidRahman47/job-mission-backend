// Email capture, step 1: capture tokens and the Gmail ingest endpoint (email-capture.md §0).
import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, loggedInUser, type Agent } from './helpers.ts';

function email(overrides: Record<string, unknown> = {}) {
  return {
    gmailId: '18c2f0a1b2c3d4e5',
    threadId: '18c2f0a1b2c3d4e5',
    direction: 'received',
    from: '"LinkedIn" <jobs-noreply@linkedin.com>',
    to: ['me@gmail.com'],
    subject: 'Your application was sent to Systems Limited',
    sentAt: '2026-10-25T09:15:00+05:00',
    text: 'Your application was sent to Systems Limited. Software Engineer · Lahore, Pakistan',
    ...overrides,
  };
}

async function createToken(agent: Agent): Promise<string> {
  const res = await agent.post('/api/v1/capture/token').expect(201);
  return (res.body as { data: { token: string } }).data.token;
}

function ingest(token: string | null, body: unknown) {
  const req = request(app).post('/api/v1/inbound/gmail');
  if (token !== null) void req.set('Authorization', `Bearer ${token}`);
  return req.send(body as object);
}

function inboundEmails() {
  return mongoose.connection.collection('inboundemails');
}

describe('capture token', () => {
  it('is shown once, then only its status is readable', async () => {
    const { agent } = await loggedInUser();
    await agent
      .get('/api/v1/capture/token')
      .expect(200, { data: { active: false, createdAt: null, lastUsedAt: null } });

    const token = await createToken(agent);
    expect(token).toMatch(/^[\w-]{43}$/);

    const status = await agent.get('/api/v1/capture/token').expect(200);
    const data = (status.body as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ active: true, lastUsedAt: null });
    expect(JSON.stringify(status.body)).not.toContain(token);
  });

  it('a new token replaces the old one, and revoking stops ingest', async () => {
    const { agent } = await loggedInUser();
    const first = await createToken(agent);
    const second = await createToken(agent);

    await ingest(first, { messages: [email()] }).expect(401);
    await ingest(second, { messages: [email()] }).expect(200);

    await agent.delete('/api/v1/capture/token').expect(204);
    const res = await ingest(second, { messages: [email({ gmailId: 'other' })] }).expect(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('CAPTURE_TOKEN_INVALID');
  });

  it('needs a session and the CSRF header', async () => {
    await request(app).get('/api/v1/capture/token').expect(401);
    const { agent } = await loggedInUser();
    await agent.post('/api/v1/capture/token').unset('X-Requested-With').expect(403);
  });
});

describe('POST /inbound/gmail', () => {
  it('rejects a missing or unknown token', async () => {
    await ingest(null, { messages: [email()] }).expect(401);
    await ingest('not-a-real-token', { messages: [email()] }).expect(401);
    expect(await inboundEmails().countDocuments()).toBe(0);
  });

  it('stores new emails for the token owner and records the token use', async () => {
    const { agent, userId } = await loggedInUser();
    const token = await createToken(agent);

    const res = await ingest(token, {
      messages: [email(), email({ gmailId: 'sent-1', direction: 'sent', to: ['hr@acme.com.pk'] })],
    }).expect(200);
    expect(res.body).toEqual({ data: { stored: 2, duplicates: 0 } });

    const stored = await inboundEmails().find().sort({ gmailId: 1 }).toArray();
    expect(stored).toHaveLength(2);
    expect(stored.map((e) => String(e.userId))).toEqual([userId, userId]);
    // No rule matches this LinkedIn email yet, so processing leaves it for the LLM stage.
    expect(stored[0]).toMatchObject({ state: 'ignored', outcome: 'no_rule', attempts: 1 });
    expect(stored[0]?.sentAt).toEqual(new Date('2026-10-25T04:15:00Z'));
    expect(stored[0]?.expiresAt).toBeInstanceOf(Date);

    const status = await agent.get('/api/v1/capture/token').expect(200);
    expect((status.body as { data: { lastUsedAt: string | null } }).data.lastUsedAt).not.toBeNull();
  });

  it('ignores emails it has already stored, so the script can resend safely', async () => {
    const { agent } = await loggedInUser();
    const token = await createToken(agent);
    await ingest(token, { messages: [email()] }).expect(200);

    const res = await ingest(token, { messages: [email(), email({ gmailId: 'new' })] }).expect(200);
    expect(res.body).toEqual({ data: { stored: 1, duplicates: 1 } });
    expect(await inboundEmails().countDocuments()).toBe(2);
  });

  it("keeps each user's emails separate, even with the same Gmail ID", async () => {
    const alice = await loggedInUser();
    const bob = await loggedInUser();
    await ingest(await createToken(alice.agent), { messages: [email()] }).expect(200);
    await ingest(await createToken(bob.agent), { messages: [email()] }).expect(200);
    expect(await inboundEmails().countDocuments()).toBe(2);
  });

  it('validates the payload', async () => {
    const { agent } = await loggedInUser();
    const token = await createToken(agent);
    await ingest(token, { messages: [] }).expect(400);
    await ingest(token, { messages: [email({ direction: 'forwarded' })] }).expect(400);
    await ingest(token, { messages: [email({ sentAt: 'yesterday' })] }).expect(400);
    await ingest(token, {
      messages: Array.from({ length: 21 }, (_, i) => email({ gmailId: `m${String(i)}` })),
    }).expect(400);
  });

  it('accepts bodies over the global 100 KB limit, up to 2 MB', async () => {
    const { agent } = await loggedInUser();
    const token = await createToken(agent);
    const messages = Array.from({ length: 3 }, (_, i) =>
      email({ gmailId: `big${String(i)}`, text: 'x'.repeat(90_000) }),
    );
    await ingest(token, { messages }).expect(200);
  });

  it('account deletion removes captured emails and the token', async () => {
    const { agent, password } = await loggedInUser();
    const token = await createToken(agent);
    await ingest(token, { messages: [email()] }).expect(200);

    await agent.delete('/api/v1/users/me').send({ password }).expect(204);
    expect(await inboundEmails().countDocuments()).toBe(0);
    expect(await mongoose.connection.collection('capturetokens').countDocuments()).toBe(0);
  });
});

describe('processing captured emails', () => {
  const indeedEmail = (overrides: Record<string, unknown> = {}) =>
    email({
      gmailId: 'indeed-1',
      from: 'Indeed Apply <indeedapply@indeed.com>',
      subject: 'Indeed Application: Front-End Design Engineer',
      sentAt: '2026-10-25T18:06:00+05:00',
      text: [
        'Application submitted',
        'Front-End Design Engineer',
        'Python Technologies - Islamabad',
        'Dha Phase-Ii',
        'The following items were sent to Python Technologies. Good luck!',
      ].join('\n\n'),
      ...overrides,
    });

  it('an Indeed confirmation becomes an applied application with a follow-up a week later', async () => {
    const { agent } = await loggedInUser();
    const token = await createToken(agent);
    await ingest(token, { messages: [indeedEmail()] }).expect(200);

    const list = await agent.get('/api/v1/applications').expect(200);
    const apps = (list.body as { data: Record<string, unknown>[] }).data;
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      companyName: 'Python Technologies',
      title: 'Front-End Design Engineer',
      location: 'Islamabad',
      source: 'indeed',
      status: 'applied',
      appliedAt: '2026-10-25T13:06:00.000Z',
    });

    const detail = await agent.get(`/api/v1/applications/${String(apps[0]?.id)}`).expect(200);
    const due = (detail.body as { data: { pendingReminders: { title: string; dueAt: string }[] } })
      .data.pendingReminders;
    expect(due).toHaveLength(1);
    expect(due[0]?.title).toBe('Follow up with Python Technologies');
    // A week after applying, or an hour from now if that's already past.
    const expected = Math.max(Date.parse('2026-11-01T13:06:00Z'), Date.now() + 60 * 60_000);
    expect(Math.abs(Date.parse(due[0]?.dueAt ?? '') - expected)).toBeLessThan(5 * 60_000);

    const stored = await inboundEmails().findOne({ gmailId: 'indeed-1' });
    expect(stored).toMatchObject({ state: 'processed', outcome: 'created' });
  });

  it('does not duplicate an application already tracked, by email or by hand', async () => {
    const { agent } = await loggedInUser();
    await agent
      .post('/api/v1/applications')
      .send({
        companyName: 'python technologies',
        title: 'Front-End Design Engineer',
        status: 'applied',
        appliedAt: '2026-10-24',
      })
      .expect(201);

    const token = await createToken(agent);
    await ingest(token, { messages: [indeedEmail()] }).expect(200);
    await ingest(token, { messages: [indeedEmail({ gmailId: 'indeed-2' })] }).expect(200);

    const list = await agent.get('/api/v1/applications').expect(200);
    expect((list.body as { data: unknown[] }).data).toHaveLength(1);
    const outcomes = await inboundEmails()
      .find()
      .map((e) => e.outcome as unknown)
      .toArray();
    expect(outcomes).toEqual(['duplicate', 'duplicate']);
  });

  it('creates nothing for an email no rule recognises', async () => {
    const { agent } = await loggedInUser();
    const token = await createToken(agent);
    await ingest(token, {
      messages: [indeedEmail({ from: 'Indeed <alert@indeed.com>', subject: '5 new jobs' })],
    }).expect(200);

    const list = await agent.get('/api/v1/applications').expect(200);
    expect((list.body as { data: unknown[] }).data).toHaveLength(0);
  });
});
