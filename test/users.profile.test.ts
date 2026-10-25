// FR-017 to FR-019: profile, job-search preferences, notification settings.
import { describe, expect, it } from 'vitest';
import { data, loggedInUser } from './helpers.ts';

interface Me {
  name: string;
  timezone: string;
  preferences: { targetTitles: string[]; workMode: string; weeklyGoal: number };
  notifications: { dailyDigest: boolean; digestHour: number };
}

describe('profile', () => {
  it('updates name and timezone', async () => {
    const { agent } = await loggedInUser();
    const res = await agent
      .patch('/api/v1/users/me')
      .send({ name: 'Ada L.', timezone: 'Europe/Berlin' })
      .expect(200);
    expect(data<Me>(res)).toMatchObject({ name: 'Ada L.', timezone: 'Europe/Berlin' });
  });

  it('rejects an unknown timezone, an empty update and unknown fields', async () => {
    const { agent } = await loggedInUser();
    await agent.patch('/api/v1/users/me').send({ timezone: 'Mars/Base' }).expect(400);
    await agent.patch('/api/v1/users/me').send({}).expect(400);
    await agent.patch('/api/v1/users/me').send({ email: 'new@example.com' }).expect(400);
  });

  it('replaces preferences and notification settings', async () => {
    const { agent } = await loggedInUser();
    await agent
      .put('/api/v1/users/me/preferences')
      .send({
        targetTitles: ['Staff Engineer'],
        targetLocations: ['Remote'],
        workMode: 'remote',
        weeklyGoal: 15,
      })
      .expect(200);
    const res = await agent
      .put('/api/v1/users/me/notifications')
      .send({ reminderEmails: false, dailyDigest: true, digestHour: 7 })
      .expect(200);
    expect(data<Me>(res)).toMatchObject({
      preferences: { targetTitles: ['Staff Engineer'], workMode: 'remote', weeklyGoal: 15 },
      notifications: { dailyDigest: true, digestHour: 7 },
    });
  });

  it('validates preference values', async () => {
    const { agent } = await loggedInUser();
    await agent
      .put('/api/v1/users/me/preferences')
      .send({ targetTitles: [], targetLocations: [], workMode: 'remote', weeklyGoal: 500 })
      .expect(400);
    // PUT means the whole object: a partial body is rejected.
    await agent.put('/api/v1/users/me/notifications').send({ dailyDigest: true }).expect(400);
  });
});
