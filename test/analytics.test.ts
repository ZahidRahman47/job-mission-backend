// FR-048 to FR-054, US-08: dashboard metrics with the exact formulas from requirements.md 4.
import { describe, expect, it } from 'vitest';
import { createApplication, data, loggedInUser, moveTo, type Agent } from './helpers.ts';

interface Summary {
  total: number;
  activePipeline: number;
  responseRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
  offerPerInterview: number | null;
  byStatus: Record<string, number>;
  followUpsDue: number;
}

async function summary(agent: Agent, query = ''): Promise<Summary> {
  return data<Summary>(await agent.get(`/api/v1/analytics/summary${query}`).expect(200));
}

// The US-08 fixture: 10 applied applications with known outcomes.
async function buildFixture(agent: Agent): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const source = i <= 2 ? 'referral' : 'linkedin';
    ids.push((await createApplication(agent, { title: `A${String(i)}`, source })).id);
  }
  const [a1, a2, a3, a4, a5, a6] = ids as [string, string, string, string, string, string];
  await moveTo(agent, a1, 'screening', 'interview', 'offer');
  await moveTo(agent, a2, 'screening', 'interview');
  await moveTo(agent, a3, 'screening', 'rejected');
  await moveTo(agent, a4, 'rejected');
  await moveTo(agent, a5, 'rejected');
  await moveTo(agent, a6, 'withdrawn');
  return ids;
}

describe('GET /analytics/summary', () => {
  it('matches the US-08 fixture exactly', async () => {
    const { agent } = await loggedInUser();
    await buildFixture(agent);

    expect(await summary(agent)).toMatchObject({
      total: 10,
      activePipeline: 6, // A1 offer, A2 interview, A7-A10 applied
      responseRate: 0.5, // A1-A5: a rejection is a response, a withdrawal is not
      interviewRate: 0.2,
      offerRate: 0.1,
      offerPerInterview: 0.5,
      byStatus: {
        applied: 4,
        interview: 1,
        offer: 1,
        rejected: 3,
        withdrawn: 1,
        saved: 0,
        screening: 0,
        accepted: 0,
      },
    });
  });

  it('excludes saved jobs and keeps archived applications in the numbers', async () => {
    const { agent } = await loggedInUser();
    const ids = await buildFixture(agent);
    await createApplication(agent, { title: 'Just saved', status: 'saved' });
    await agent.post(`/api/v1/applications/${ids[9] ?? ''}/archive`).expect(200);
    expect((await summary(agent)).total).toBe(10);
  });

  it('returns null rates instead of dividing by zero (FR-054)', async () => {
    const { agent } = await loggedInUser();
    expect(await summary(agent)).toMatchObject({
      total: 0,
      responseRate: null,
      interviewRate: null,
      offerRate: null,
      offerPerInterview: null,
    });
  });

  it('only counts applications inside the selected range', async () => {
    const { agent } = await loggedInUser();
    await createApplication(agent, { title: 'Old', appliedAt: '2025-01-15' });
    await createApplication(agent, { title: 'In range', appliedAt: '2025-03-10' });
    expect((await summary(agent, '?from=2025-03-01&to=2025-03-31')).total).toBe(1);
  });

  it('validates the range', async () => {
    const { agent } = await loggedInUser();
    await agent.get('/api/v1/analytics/summary?from=2026-10-10&to=2026-10-01').expect(400);
    await agent.get('/api/v1/analytics/summary?from=2020-01-01&to=2026-10-01').expect(400);
  });

  it('counts follow-ups due by the end of today', async () => {
    const { agent } = await loggedInUser();
    await agent
      .post('/api/v1/reminders')
      .send({ title: 'late', dueAt: new Date(Date.now() - 3_600_000).toISOString() })
      .expect(201);
    await agent
      .post('/api/v1/reminders')
      .send({ title: 'next week', dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString() })
      .expect(201);
    expect((await summary(agent)).followUpsDue).toBe(1);
  });
});

describe('timeseries, sources, upcoming', () => {
  it('returns contiguous weekly buckets with gaps filled as zero', async () => {
    const { agent } = await loggedInUser();
    await createApplication(agent, { appliedAt: '2026-09-02' }); // a Wednesday
    await createApplication(agent, { title: 'Two', appliedAt: '2026-09-03' });
    await createApplication(agent, { title: 'Three', appliedAt: '2026-09-21' });

    const series = data<{ buckets: { label: string; count: number }[] }>(
      await agent
        .get('/api/v1/analytics/timeseries?from=2026-09-01&to=2026-09-30&interval=week')
        .expect(200),
    );
    expect(series.buckets).toEqual([
      { start: '2026-08-31T00:00:00.000Z', label: '2026-08-31', count: 2 },
      { start: '2026-09-07T00:00:00.000Z', label: '2026-09-07', count: 0 },
      { start: '2026-09-14T00:00:00.000Z', label: '2026-09-14', count: 0 },
      { start: '2026-09-21T00:00:00.000Z', label: '2026-09-21', count: 1 },
      { start: '2026-09-28T00:00:00.000Z', label: '2026-09-28', count: 0 },
    ]);
  });

  it("groups months in the user's timezone", async () => {
    const { agent } = await loggedInUser({ timezone: 'Asia/Karachi' });
    // 1 Oct 00:30 in Karachi is still 30 Sep in UTC: it must count for October.
    await createApplication(agent, { appliedAt: '2026-09-30T19:30:00Z' });
    const series = data<{ buckets: { label: string; count: number }[] }>(
      await agent
        .get('/api/v1/analytics/timeseries?from=2026-09-01&to=2026-10-31&interval=month')
        .expect(200),
    );
    expect(series.buckets.map((b) => [b.label, b.count])).toEqual([
      ['2026-09-01', 0],
      ['2026-10-01', 1],
    ]);
  });

  it('shows which sources get responses and interviews', async () => {
    const { agent } = await loggedInUser();
    await buildFixture(agent);
    const sources = data<
      { source: string; total: number; responseRate: number | null; interviewRate: number | null }[]
    >(await agent.get('/api/v1/analytics/sources').expect(200));
    expect(sources).toEqual([
      {
        source: 'linkedin',
        total: 8,
        responded: 3,
        interviewed: 0,
        responseRate: 0.375,
        interviewRate: 0,
      },
      {
        source: 'referral',
        total: 2,
        responded: 2,
        interviewed: 2,
        responseRate: 1,
        interviewRate: 1,
      },
    ]);
  });

  it('lists overdue reminders and pending interviews in the next 7 days', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent, { companyName: 'Globex', title: 'SRE' });
    await agent
      .post(`/api/v1/applications/${app.id}/interviews`)
      .send({
        round: 1,
        type: 'technical',
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(201);
    await agent
      .post(`/api/v1/applications/${app.id}/interviews`)
      .send({
        round: 2,
        type: 'final',
        scheduledAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      })
      .expect(201);
    await agent
      .post('/api/v1/reminders')
      .send({ title: 'Overdue', dueAt: new Date(Date.now() - 3_600_000).toISOString() })
      .expect(201);

    const upcoming = await agent.get('/api/v1/analytics/upcoming').expect(200);
    expect(upcoming.body).toMatchObject({
      data: {
        overdueReminders: [{ title: 'Overdue' }],
        interviews: [{ companyName: 'Globex', title: 'SRE', interview: { round: 1 } }],
      },
    });
    expect(data<{ interviews: unknown[] }>(upcoming).interviews).toHaveLength(1);
  });

  it('serves the recent activity feed with cursor pagination', async () => {
    const { agent } = await loggedInUser();
    for (let i = 1; i <= 3; i++) await createApplication(agent, { title: `Role ${String(i)}` });

    const first = await agent.get('/api/v1/activities?limit=2').expect(200);
    const page1 = first.body as {
      data: { data: { applicationTitle: string } }[];
      meta: { nextCursor: string | null };
    };
    expect(page1.data.map((a) => a.data.applicationTitle)).toEqual(['Role 3', 'Role 2']);
    expect(page1.meta.nextCursor).not.toBeNull();

    const second = await agent
      .get(`/api/v1/activities?limit=2&cursor=${page1.meta.nextCursor ?? ''}`)
      .expect(200);
    const page2 = second.body as {
      data: { data: { applicationTitle: string } }[];
      meta: { nextCursor: string | null };
    };
    expect(page2.data.map((a) => a.data.applicationTitle)).toEqual(['Role 1']);
    expect(page2.meta.nextCursor).toBeNull();

    await agent.get('/api/v1/activities?cursor=garbage').expect(400);
  });
});
