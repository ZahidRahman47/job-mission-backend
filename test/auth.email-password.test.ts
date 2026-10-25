// FR-003, FR-004, FR-011 to FR-013, US-03: email verification, forgot/reset password, change password.
import { describe, expect, it } from 'vitest';
import { AuthTokenModel } from '../src/modules/auth/auth-token.model.ts';
import {
  client,
  emailsTo,
  loggedInUser,
  registerUser,
  tokenFromLastEmail,
  uniqueEmail,
  withoutRequestId,
} from './helpers.ts';

const VERIFY_SUBJECT = 'Verify your Mission Control email';
const RESET_SUBJECT = 'Reset your Mission Control password';
const NEW_PASSWORD = 'a-brand-new-long-password';

describe('email verification', () => {
  it('verifies with the emailed token, exactly once', async () => {
    const { agent, email } = await loggedInUser();
    const token = tokenFromLastEmail(email, VERIFY_SUBJECT);

    await client().post('/api/v1/auth/verify-email').send({ token }).expect(200);
    const me = await agent.get('/api/v1/users/me').expect(200);
    expect((me.body as { data: { emailVerified: boolean } }).data.emailVerified).toBe(true);

    const reuse = await client().post('/api/v1/auth/verify-email').send({ token }).expect(400);
    expect((reuse.body as { error: { code: string } }).error.code).toBe('TOKEN_INVALID');
  });

  it('rejects an expired token', async () => {
    const { email } = await registerUser();
    const token = tokenFromLastEmail(email, VERIFY_SUBJECT);
    await AuthTokenModel.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await client().post('/api/v1/auth/verify-email').send({ token }).expect(400);
  });

  it('rejects a made-up token', async () => {
    await client()
      .post('/api/v1/auth/verify-email')
      .send({ token: 'x'.repeat(43) })
      .expect(400);
  });

  it('resending invalidates the previous link', async () => {
    const { agent, email } = await loggedInUser();
    const oldToken = tokenFromLastEmail(email, VERIFY_SUBJECT);

    await agent.post('/api/v1/auth/verify-email/resend').expect(202);
    const newToken = tokenFromLastEmail(email, VERIFY_SUBJECT);
    expect(newToken).not.toBe(oldToken);

    await client().post('/api/v1/auth/verify-email').send({ token: oldToken }).expect(400);
    await client().post('/api/v1/auth/verify-email').send({ token: newToken }).expect(200);
  });

  it('resend does nothing once verified', async () => {
    const { agent, email } = await loggedInUser();
    await client()
      .post('/api/v1/auth/verify-email')
      .send({ token: tokenFromLastEmail(email, VERIFY_SUBJECT) })
      .expect(200);
    const before = emailsTo(email).length;
    await agent.post('/api/v1/auth/verify-email/resend').expect(202);
    expect(emailsTo(email)).toHaveLength(before);
  });
});

describe('forgot and reset password', () => {
  it('answers identically for known and unknown emails, emailing only the real owner', async () => {
    const { email } = await registerUser();
    const unknown = uniqueEmail();

    const known = await client().post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    const missing = await client()
      .post('/api/v1/auth/password/forgot')
      .send({ email: unknown })
      .expect(202);

    expect(withoutRequestId(missing.body)).toEqual(withoutRequestId(known.body));
    expect(emailsTo(email).some((mail) => mail.subject === RESET_SUBJECT)).toBe(true);
    expect(emailsTo(unknown)).toHaveLength(0);
  });

  it('resets once, logs out every session, and only the new password works', async () => {
    const { agent, email, password } = await loggedInUser();
    await client().post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    const token = tokenFromLastEmail(email, RESET_SUBJECT);

    await client()
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(204);

    await agent.get('/api/v1/users/me').expect(401);
    await client().post('/api/v1/auth/login').send({ email, password }).expect(401);
    await client().post('/api/v1/auth/login').send({ email, password: NEW_PASSWORD }).expect(200);
    expect(emailsTo(email).at(-1)?.subject).toBe('Your Mission Control password was changed');

    await client()
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'yet-another-long-password' })
      .expect(400);
  });

  it('a newer reset request invalidates the older link', async () => {
    const { email } = await registerUser();
    await client().post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    const oldToken = tokenFromLastEmail(email, RESET_SUBJECT);
    await client().post('/api/v1/auth/password/forgot').send({ email }).expect(202);

    await client()
      .post('/api/v1/auth/password/reset')
      .send({ token: oldToken, password: NEW_PASSWORD })
      .expect(400);
  });

  it('rejects an expired reset link', async () => {
    const { email } = await registerUser();
    await client().post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    const token = tokenFromLastEmail(email, RESET_SUBJECT);
    await AuthTokenModel.updateMany(
      { type: 'reset_password' },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await client()
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(400);
  });

  it('still enforces the password policy on reset', async () => {
    const { email } = await registerUser();
    await client().post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    const token = tokenFromLastEmail(email, RESET_SUBJECT);
    await client()
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'short' })
      .expect(400);
  });
});

describe('POST /auth/password/change', () => {
  it('rejects a wrong current password', async () => {
    const { agent } = await loggedInUser();
    const res = await agent
      .post('/api/v1/auth/password/change')
      .send({ currentPassword: 'not-my-password', newPassword: NEW_PASSWORD })
      .expect(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('changes the password, keeps this session and signs out the others', async () => {
    const { agent, email, password } = await loggedInUser();
    const phone = client();
    await phone.post('/api/v1/auth/login').send({ email, password }).expect(200);

    await agent
      .post('/api/v1/auth/password/change')
      .send({ currentPassword: password, newPassword: NEW_PASSWORD })
      .expect(204);

    await agent.get('/api/v1/users/me').expect(200);
    await phone.get('/api/v1/users/me').expect(401);
    await client().post('/api/v1/auth/login').send({ email, password: NEW_PASSWORD }).expect(200);
  });
});
