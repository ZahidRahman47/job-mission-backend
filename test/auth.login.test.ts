// FR-005 to FR-010, US-02: login, cookie flags, /users/me, logout, expiry, sliding idle window.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SessionModel } from '../src/modules/auth/session.model.ts';
import { hashToken } from '../src/lib/tokens.ts';
import {
  app,
  client,
  loggedInUser,
  registerUser,
  sessionCookie,
  uniqueEmail,
  withoutRequestId,
} from './helpers.ts';

const MINUTE = 60_000;

describe('POST /auth/login', () => {
  it('logs in, sets a hardened session cookie and stores only the token hash', async () => {
    const { email, password } = await registerUser({ name: 'Grace' });
    const res = await client().post('/api/v1/auth/login').send({ email, password }).expect(200);

    expect(res.body).toMatchObject({
      data: { name: 'Grace', email, emailVerified: false, isDemo: false, timezone: 'UTC' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

    const cookie = sessionCookie(res) ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=2592000/); // 30 days
    expect(cookie).not.toMatch(/Secure/i); // only in production (HTTPS)

    const token = /^mc_session=([^;]+)/.exec(cookie)?.[1] ?? '';
    expect(token.length).toBeGreaterThanOrEqual(43); // 256 bits, base64url
    expect(await SessionModel.countDocuments({ tokenHash: token })).toBe(0);
    expect(await SessionModel.countDocuments({ tokenHash: hashToken(token) })).toBe(1);
  });

  it('accepts the email in any case and with spaces', async () => {
    const { email, password } = await registerUser();
    await client()
      .post('/api/v1/auth/login')
      .send({ email: ` ${email.toUpperCase()} `, password })
      .expect(200);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const { email } = await registerUser();
    const wrongPassword = await client()
      .post('/api/v1/auth/login')
      .send({ email, password: 'definitely-not-it' })
      .expect(401);
    const unknownEmail = await client()
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail(), password: 'definitely-not-it' })
      .expect(401);

    expect(withoutRequestId(wrongPassword.body)).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
    });
    expect(withoutRequestId(unknownEmail.body)).toEqual(withoutRequestId(wrongPassword.body));
  });
});

describe('GET /users/me', () => {
  it('returns the logged-in user', async () => {
    const { agent, email, userId } = await loggedInUser();
    const res = await agent.get('/api/v1/users/me').expect(200);
    expect(res.body).toEqual({
      data: {
        id: userId,
        name: 'Test User',
        email,
        timezone: 'UTC',
        emailVerified: false,
        isDemo: false,
        preferences: { targetTitles: [], targetLocations: [], workMode: 'any', weeklyGoal: 0 },
        notifications: { reminderEmails: true, dailyDigest: false, digestHour: 8 },
        createdAt: expect.any(String) as string,
      },
    });
  });

  it('returns 401 UNAUTHENTICATED without a cookie', async () => {
    const res = await request(app).get('/api/v1/users/me').expect(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 and clears a cookie that matches no session', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Cookie', 'mc_session=forged-token-value-that-matches-nothing')
      .expect(401);
    expect(sessionCookie(res)).toMatch(/mc_session=;/);
  });
});

describe('logout', () => {
  it('revokes the session on the server, not just the cookie', async () => {
    const { email, password } = await registerUser();
    const agent = client();
    const login = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
    const stolenCookie = (sessionCookie(login) ?? '').split(';')[0] ?? '';

    const res = await agent.post('/api/v1/auth/logout').expect(204);
    expect(sessionCookie(res)).toMatch(/mc_session=;/);

    await agent.get('/api/v1/users/me').expect(401);
    // Even a copy of the old cookie no longer works.
    await request(app).get('/api/v1/users/me').set('Cookie', stolenCookie).expect(401);
  });

  it('logout-all revokes every device', async () => {
    const { agent, email, password } = await loggedInUser();
    const laptop = client();
    await laptop.post('/api/v1/auth/login').send({ email, password }).expect(200);

    await agent.post('/api/v1/auth/logout-all').expect(204);

    await agent.get('/api/v1/users/me').expect(401);
    await laptop.get('/api/v1/users/me').expect(401);
  });

  it('requires a session', async () => {
    await client().post('/api/v1/auth/logout').expect(401);
  });
});

describe('session expiry', () => {
  it('rejects and deletes a session idle for longer than 7 days', async () => {
    const { agent, userId } = await loggedInUser();
    await SessionModel.updateMany(
      { userId },
      { $set: { idleExpiresAt: new Date(Date.now() - MINUTE) } },
    );

    const res = await agent.get('/api/v1/users/me').expect(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('SESSION_EXPIRED');
    expect(await SessionModel.countDocuments({ userId })).toBe(0);
  });

  it('rejects a session past its 30-day absolute lifetime even if recently used', async () => {
    const { agent, userId } = await loggedInUser();
    await SessionModel.updateMany(
      { userId },
      { $set: { expiresAt: new Date(Date.now() - MINUTE) } },
    );
    const res = await agent.get('/api/v1/users/me').expect(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('SESSION_EXPIRED');
  });

  it('slides the idle window on activity, at most every 5 minutes', async () => {
    const { agent, userId } = await loggedInUser();
    const tenMinutesAgo = new Date(Date.now() - 10 * MINUTE);
    await SessionModel.updateMany(
      { userId },
      { $set: { lastSeenAt: tenMinutesAgo, idleExpiresAt: new Date(Date.now() + MINUTE) } },
    );

    await agent.get('/api/v1/users/me').expect(200);
    const session = await SessionModel.findOne({ userId }).lean();
    expect(session?.lastSeenAt.getTime()).toBeGreaterThan(tenMinutesAgo.getTime());
    expect(session?.idleExpiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * MINUTE);

    // A second request right away does not write again.
    const lastSeen = session?.lastSeenAt.getTime();
    await agent.get('/api/v1/users/me').expect(200);
    expect((await SessionModel.findOne({ userId }).lean())?.lastSeenAt.getTime()).toBe(lastSeen);
  });
});
