// FR-015, NFR-014: brute-force and abuse limits.
import { describe, expect, it } from 'vitest';
import { REGISTER_PER_IP_PER_HOUR } from '../src/middleware/rate-limit.ts';
import { client, registerUser, uniqueEmail } from './helpers.ts';

describe('rate limiting', () => {
  it('blocks the 6th login attempt after 5 failures, even with the right password', async () => {
    const { email, password } = await registerUser();

    for (let attempt = 1; attempt <= 5; attempt++) {
      await client()
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-guess' })
        .expect(401);
    }

    const blocked = await client().post('/api/v1/auth/login').send({ email, password }).expect(429);
    expect(blocked.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not count successful logins', async () => {
    const { email, password } = await registerUser();
    for (let attempt = 1; attempt <= 7; attempt++) {
      await client().post('/api/v1/auth/login').send({ email, password }).expect(200);
    }
  });

  it("one account's failures don't lock out a different account", async () => {
    const victim = await registerUser();
    const other = await registerUser();
    for (let attempt = 1; attempt <= 5; attempt++) {
      await client()
        .post('/api/v1/auth/login')
        .send({ email: victim.email, password: 'wrong-guess' })
        .expect(401);
    }
    await client().post('/api/v1/auth/login').send(other).expect(200);
  });

  it('limits password-reset emails to 3 per hour per address', async () => {
    const { email } = await registerUser();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await client().post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    }
    await client().post('/api/v1/auth/password/forgot').send({ email }).expect(429);
  });

  it('allows many sign-ups from one shared IP (mobile carrier NAT), then stops bots', async () => {
    for (let attempt = 1; attempt <= REGISTER_PER_IP_PER_HOUR; attempt++) {
      await registerUser();
    }
    await client()
      .post('/api/v1/auth/register')
      .send({
        name: 'One too many',
        email: uniqueEmail(),
        password: 'correct-horse-battery-staple',
      })
      .expect(429);
  });

  it('many people logging in from one shared IP are never blocked by each other', async () => {
    const people = await Promise.all(Array.from({ length: 25 }, () => registerUser()));
    for (const person of people) {
      await client().post('/api/v1/auth/login').send(person).expect(200);
    }
  });
});
