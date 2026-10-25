// FR-014, FR-016, BR-022, US-06, US-10: sessions list/revoke, cross-user isolation, account deletion.
import { describe, expect, it } from 'vitest';
import { AuthTokenModel } from '../src/modules/auth/auth-token.model.ts';
import { resumePendingDeletions } from '../src/modules/auth/auth.service.ts';
import { SessionModel } from '../src/modules/auth/session.model.ts';
import { UserModel } from '../src/modules/users/users.model.ts';
import { client, loggedInUser } from './helpers.ts';

interface SessionView {
  id: string;
  current: boolean;
  userAgent: string | null;
  ipPrefix: string | null;
}

async function sessionsOf(agent: ReturnType<typeof client>): Promise<SessionView[]> {
  const res = await agent.get('/api/v1/users/me/sessions').expect(200);
  return (res.body as { data: SessionView[] }).data;
}

describe('sessions', () => {
  it('lists my sessions and marks the current one', async () => {
    const { agent, email, password } = await loggedInUser();
    await client().post('/api/v1/auth/login').send({ email, password }).expect(200);

    const sessions = await sessionsOf(agent);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    expect(sessions[0]?.ipPrefix).toBe('127.0.0.0/24');
  });

  it('revokes another of my sessions', async () => {
    const { agent, email, password } = await loggedInUser();
    const laptop = client();
    await laptop.post('/api/v1/auth/login').send({ email, password }).expect(200);

    const other = (await sessionsOf(agent)).find((session) => !session.current);
    await agent.delete(`/api/v1/users/me/sessions/${other?.id ?? ''}`).expect(204);

    await laptop.get('/api/v1/users/me').expect(401);
    await agent.get('/api/v1/users/me').expect(200);
  });

  it("returns 404 for another user's session and leaves it working (no IDOR)", async () => {
    const alice = await loggedInUser();
    const bob = await loggedInUser();
    const bobSessionId = (await sessionsOf(bob.agent))[0]?.id ?? '';

    const res = await alice.agent.delete(`/api/v1/users/me/sessions/${bobSessionId}`).expect(404);
    expect(res.body).toMatchObject({
      error: { code: 'NOT_FOUND', details: { resource: 'Session' } },
    });

    await bob.agent.get('/api/v1/users/me').expect(200);
    expect(await sessionsOf(alice.agent)).toHaveLength(1);
  });

  it('rejects a malformed session id with 400', async () => {
    const { agent } = await loggedInUser();
    await agent.delete('/api/v1/users/me/sessions/not-an-id').expect(400);
  });

  it("never lists another user's sessions", async () => {
    const alice = await loggedInUser();
    await loggedInUser();
    expect(await sessionsOf(alice.agent)).toHaveLength(1);
  });
});

describe('DELETE /users/me', () => {
  it('requires the correct password', async () => {
    const { agent, userId } = await loggedInUser();
    await agent.delete('/api/v1/users/me').send({ password: 'not-my-password' }).expect(401);
    expect(await UserModel.countDocuments({ _id: userId })).toBe(1);
  });

  it('deletes the user and every session and token, everywhere', async () => {
    const { agent, email, password, userId } = await loggedInUser();
    const phone = client();
    await phone.post('/api/v1/auth/login').send({ email, password }).expect(200);
    await client().post('/api/v1/auth/password/forgot').send({ email }).expect(202);

    await agent.delete('/api/v1/users/me').send({ password }).expect(204);

    expect(await UserModel.countDocuments({ _id: userId })).toBe(0);
    expect(await SessionModel.countDocuments({ userId })).toBe(0);
    expect(await AuthTokenModel.countDocuments({ userId })).toBe(0);
    await agent.get('/api/v1/users/me').expect(401);
    await phone.get('/api/v1/users/me').expect(401);
    await client().post('/api/v1/auth/login').send({ email, password }).expect(401);
  });

  it("does not touch another user's data", async () => {
    const alice = await loggedInUser();
    const bob = await loggedInUser();
    await alice.agent.delete('/api/v1/users/me').send({ password: alice.password }).expect(204);
    await bob.agent.get('/api/v1/users/me').expect(200);
  });
});

describe('interrupted account deletion', () => {
  it('blocks login once deletion has started', async () => {
    const { email, password, userId } = await loggedInUser();
    await UserModel.updateOne({ _id: userId }, { $set: { deletionRequestedAt: new Date() } });
    await client().post('/api/v1/auth/login').send({ email, password }).expect(401);
  });

  it('is finished by resumePendingDeletions at startup', async () => {
    const { userId } = await loggedInUser();
    await UserModel.updateOne({ _id: userId }, { $set: { deletionRequestedAt: new Date() } });

    await resumePendingDeletions();

    expect(await UserModel.countDocuments({ _id: userId })).toBe(0);
    expect(await SessionModel.countDocuments({ userId })).toBe(0);
  });
});
