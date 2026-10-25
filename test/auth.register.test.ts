// FR-001 to FR-003, US-01: registration, enumeration safety, validation, mass assignment.
import { describe, expect, it } from 'vitest';
import { UserModel } from '../src/modules/users/users.model.ts';
import { client, emailsTo, PASSWORD, sessionCookie, uniqueEmail } from './helpers.ts';

describe('POST /auth/register', () => {
  it('creates the user with an Argon2id hash and sends a verification email, without logging in', async () => {
    const email = uniqueEmail();
    const res = await client()
      .post('/api/v1/auth/register')
      .send({ name: 'Ada Lovelace', email, password: PASSWORD, timezone: 'Asia/Karachi' })
      .expect(202);

    expect(res.body).toEqual({
      data: { message: 'Check your email to verify your account, then log in.' },
    });
    expect(sessionCookie(res)).toBeUndefined();

    const user = await UserModel.findOne({ email }).select('+passwordHash').lean();
    expect(user?.name).toBe('Ada Lovelace');
    expect(user?.timezone).toBe('Asia/Karachi');
    expect(user?.emailVerifiedAt).toBeNull();
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toContain(PASSWORD);

    expect(emailsTo(email).map((mail) => mail.subject)).toEqual([
      'Verify your Mission Control email',
    ]);
  });

  it('returns an identical response for an already-registered email and creates nothing', async () => {
    const email = uniqueEmail();
    const first = await client()
      .post('/api/v1/auth/register')
      .send({ name: 'Original', email, password: PASSWORD })
      .expect(202);

    // Same address with different case and spaces is the same account.
    const second = await client()
      .post('/api/v1/auth/register')
      .send({
        name: 'Attacker',
        email: `  ${email.toUpperCase()} `,
        password: 'another-long-password',
      })
      .expect(202);

    expect(second.body).toEqual(first.body);
    expect(sessionCookie(second)).toBeUndefined();
    expect(await UserModel.countDocuments({ email })).toBe(1);
    expect((await UserModel.findOne({ email }).lean())?.name).toBe('Original');
    expect(emailsTo(email).map((mail) => mail.subject)).toEqual([
      'Verify your Mission Control email',
      'Someone tried to register with your email',
    ]);
  });

  it('defaults the timezone to UTC', async () => {
    const email = uniqueEmail();
    await client()
      .post('/api/v1/auth/register')
      .send({ name: 'No TZ', email, password: PASSWORD })
      .expect(202);
    expect((await UserModel.findOne({ email }).lean())?.timezone).toBe('UTC');
  });

  it('rejects a password shorter than 12 characters', async () => {
    const res = await client()
      .post('/api/v1/auth/register')
      .send({ name: 'Short', email: uniqueEmail(), password: '11-chars-xx' })
      .expect(400);
    expect(res.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        details: [
          { location: 'body', path: ['password'], message: 'Must be at least 12 characters.' },
        ],
      },
    });
  });

  it('rejects an invalid email and an unknown timezone, reporting both fields', async () => {
    const res = await client()
      .post('/api/v1/auth/register')
      .send({ name: 'Bad', email: 'not-an-email', password: PASSWORD, timezone: 'Mars/Olympus' })
      .expect(400);
    const paths = (res.body as { error: { details: { path: string[] }[] } }).error.details.map(
      (detail) => detail.path.join('.'),
    );
    expect(paths).toEqual(expect.arrayContaining(['email', 'timezone']));
  });

  it('rejects unknown fields instead of saving them (mass assignment)', async () => {
    const email = uniqueEmail();
    await client()
      .post('/api/v1/auth/register')
      .send({
        name: 'Sneaky',
        email,
        password: PASSWORD,
        emailVerifiedAt: new Date().toISOString(),
      })
      .expect(400);
    expect(await UserModel.countDocuments({ email })).toBe(0);
  });

  it('rejects MongoDB operators smuggled in place of strings (NoSQL injection)', async () => {
    await client()
      .post('/api/v1/auth/register')
      .send({ name: 'Inject', email: { $ne: null }, password: PASSWORD })
      .expect(400);
  });
});
