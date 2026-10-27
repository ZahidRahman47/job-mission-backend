// FR-041 to FR-045, BR-012, BR-013: reminders, views, duplicates and nextFollowUpAt sync.
import { describe, expect, it } from 'vitest';
import {
  createApplication,
  data,
  errorCode,
  loggedInUser,
  type Agent,
  type App,
} from './helpers.ts';

interface Reminder {
  id: string;
  title: string;
  dueAt: string;
  status: string;
}

const HOUR = 3_600_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function addReminder(agent: Agent, body: Record<string, unknown>): Promise<Reminder> {
  return data<Reminder>(
    await agent
      .post('/api/v1/reminders')
      .send({ title: 'Follow up', ...body })
      .expect(201),
  );
}

async function nextFollowUp(agent: Agent, appId: string): Promise<string | null> {
  return data<App>(await agent.get(`/api/v1/applications/${appId}`).expect(200)).nextFollowUpAt;
}

async function view(agent: Agent, name: string): Promise<string[]> {
  return data<Reminder[]>(await agent.get(`/api/v1/reminders?view=${name}`).expect(200)).map(
    (r) => r.title,
  );
}

describe('reminders', () => {
  it("keeps the application's nextFollowUpAt equal to its earliest pending reminder", async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    const later = await addReminder(agent, { dueAt: at(72 * HOUR), applicationId: app.id });
    const sooner = await addReminder(agent, { dueAt: at(24 * HOUR), applicationId: app.id });
    expect(await nextFollowUp(agent, app.id)).toBe(sooner.dueAt);

    await agent.post(`/api/v1/reminders/${sooner.id}/complete`).expect(200);
    expect(await nextFollowUp(agent, app.id)).toBe(later.dueAt);

    await agent.post(`/api/v1/reminders/${sooner.id}/reopen`).expect(200);
    expect(await nextFollowUp(agent, app.id)).toBe(sooner.dueAt);

    await agent.delete(`/api/v1/reminders/${sooner.id}`).expect(204);
    await agent.delete(`/api/v1/reminders/${later.id}`).expect(204);
    expect(await nextFollowUp(agent, app.id)).toBeNull();
  });

  it('moves the follow-up date when a reminder is re-linked to another application', async () => {
    const { agent } = await loggedInUser();
    const first = await createApplication(agent, { title: 'First' });
    const second = await createApplication(agent, { title: 'Second' });
    const reminder = await addReminder(agent, { dueAt: at(24 * HOUR), applicationId: first.id });

    await agent
      .patch(`/api/v1/reminders/${reminder.id}`)
      .send({ applicationId: second.id })
      .expect(200);
    expect(await nextFollowUp(agent, first.id)).toBeNull();
    expect(await nextFollowUp(agent, second.id)).toBe(reminder.dueAt);
  });

  it('rejects a duplicate pending reminder at the same minute (FR-044)', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    const due = new Date(Date.now() + 24 * HOUR);
    due.setUTCSeconds(0, 0);
    const first = await addReminder(agent, { dueAt: due.toISOString(), applicationId: app.id });

    const sameMinute = new Date(due.getTime() + 30_000).toISOString();
    const res = await agent
      .post('/api/v1/reminders')
      .send({ title: 'Again', dueAt: sameMinute, applicationId: app.id })
      .expect(409);
    expect(errorCode(res)).toBe('DUPLICATE_REMINDER');

    // Once the first is done, the same time is free again.
    await agent.post(`/api/v1/reminders/${first.id}/complete`).expect(200);
    await addReminder(agent, { dueAt: due.toISOString(), applicationId: app.id });
  });

  it('sorts reminders into overdue, today, upcoming and completed views', async () => {
    const { agent } = await loggedInUser();
    await addReminder(agent, { title: 'Overdue', dueAt: at(-2 * HOUR) });
    await addReminder(agent, { title: 'In 3 days', dueAt: at(72 * HOUR) });
    const done = await addReminder(agent, { title: 'Done', dueAt: at(-HOUR) });
    await agent.post(`/api/v1/reminders/${done.id}/complete`).expect(200);

    expect(await view(agent, 'overdue')).toEqual(['Overdue']);
    expect(await view(agent, 'upcoming')).toEqual(['In 3 days']);
    expect(await view(agent, 'completed')).toEqual(['Done']);

    // The counts endpoint uses the same rules, so badges match the lists.
    expect(data(await agent.get('/api/v1/reminders/counts').expect(200))).toEqual({
      overdue: 1,
      today: 0,
      upcoming: 1,
      completed: 1,
    });
  });

  it('labels list rows with their application, so clients need no extra lookup', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent, { companyName: 'Systems Ltd', title: 'Engineer' });
    await addReminder(agent, { title: 'Linked', dueAt: at(-HOUR), applicationId: app.id });
    await addReminder(agent, { title: 'Loose', dueAt: at(-2 * HOUR) });

    const rows = data<(Reminder & { application: unknown })[]>(
      await agent.get('/api/v1/reminders?view=overdue').expect(200),
    );
    expect(rows.map((r) => [r.title, r.application])).toEqual([
      ['Loose', null],
      ['Linked', { companyName: 'Systems Ltd', title: 'Engineer' }],
    ]);
    const upcoming = data<{ overdueReminders: { application: unknown }[] }>(
      await agent.get('/api/v1/analytics/upcoming').expect(200),
    );
    expect(upcoming.overdueReminders.map((r) => r.application)).toContainEqual({
      companyName: 'Systems Ltd',
      title: 'Engineer',
    });
  });

  it('records completion on the linked application timeline', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    const reminder = await addReminder(agent, {
      title: 'Send portfolio',
      dueAt: at(HOUR),
      applicationId: app.id,
    });
    await agent.post(`/api/v1/reminders/${reminder.id}/complete`).expect(200);
    await agent.post(`/api/v1/reminders/${reminder.id}/complete`).expect(200); // idempotent

    const timeline = data<{ type: string }[]>(
      await agent.get(`/api/v1/applications/${app.id}/activities`).expect(200),
    );
    expect(timeline.filter((a) => a.type === 'reminder_completed')).toHaveLength(1);
  });

  it('rejects due dates more than a year in the past or two years ahead (BR-013)', async () => {
    const { agent } = await loggedInUser();
    await agent
      .post('/api/v1/reminders')
      .send({ title: 'x', dueAt: at(-400 * 24 * HOUR) })
      .expect(400);
    await agent
      .post('/api/v1/reminders')
      .send({ title: 'x', dueAt: at(800 * 24 * HOUR) })
      .expect(400);
    await agent.post('/api/v1/reminders').send({ title: 'x', dueAt: 'tomorrow' }).expect(400);
  });
});
