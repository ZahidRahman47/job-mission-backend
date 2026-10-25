// Shared test helpers: an app instance, HTTP clients that behave like our frontend, user factories,
// and access to emails the app "sent".
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { mailer } from '../src/lib/mailer.ts';

export const app = createApp();

export const CSRF_HEADERS = { 'X-Requested-With': 'mission-control' };

// Every email the app sends lands here instead of being logged (cleared before each test).
export const mailSpy = vi.spyOn(mailer, 'send');

// A cookie-keeping client that sends the CSRF header, like our frontend will. One agent = one browser.
export function client(): ReturnType<typeof request.agent> {
  return request.agent(app).set(CSRF_HEADERS);
}

export function uniqueEmail(): string {
  return `user-${randomUUID().slice(0, 8)}@example.com`;
}

export const PASSWORD = 'correct-horse-battery-staple';

export async function registerUser(
  overrides: { email?: string; password?: string; name?: string; timezone?: string } = {},
): Promise<{ email: string; password: string }> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? PASSWORD;
  await client()
    .post('/api/v1/auth/register')
    .send({
      name: overrides.name ?? 'Test User',
      email,
      password,
      ...(overrides.timezone && { timezone: overrides.timezone }),
    })
    .expect(202);
  return { email, password };
}

export type Agent = ReturnType<typeof request.agent>;

// Registers a user and returns a logged-in client for them.
export async function loggedInUser(options: { timezone?: string } = {}): Promise<{
  agent: Agent;
  email: string;
  password: string;
  userId: string;
}> {
  const { email, password } = await registerUser(
    options.timezone === undefined ? {} : { timezone: options.timezone },
  );
  const agent = client();
  const res = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
  const body = res.body as { data: { id: string } };
  return { agent, email, password, userId: body.data.id };
}

// The raw token from the most recent email to `to` whose subject contains `subject`.
export function tokenFromLastEmail(to: string, subject: string): string {
  const message = mailSpy.mock.calls
    .map(([mail]) => mail)
    .filter((mail) => mail.to === to && mail.subject.includes(subject))
    .at(-1);
  expect(message, `expected an email to ${to} about "${subject}"`).toBeDefined();
  const match = /token=([A-Za-z0-9_-]+)/.exec(message?.text ?? '');
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

export function emailsTo(to: string): { subject: string; text: string }[] {
  return mailSpy.mock.calls.map(([mail]) => mail).filter((mail) => mail.to === to);
}

// The response body with the per-request ID removed, for "are these two responses identical?" checks.
export function withoutRequestId(body: unknown): unknown {
  const copy = structuredClone(body) as { error?: { requestId?: string } };
  if (copy.error) delete copy.error.requestId;
  return copy;
}

// `res.body.data`, typed by the caller. A deliberate cast for test readability: the shape itself
// is what the assertions then check.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function data<T>(res: { body: unknown }): T {
  return (res.body as { data: T }).data;
}

export function errorCode(res: { body: unknown }): string {
  return (res.body as { error: { code: string } }).error.code;
}

export interface App {
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  status: string;
  appliedAt: string | null;
  version: number;
  nextFollowUpAt: string | null;
  archivedAt: string | null;
  contactIds: string[];
  interviews: { id: string; round: number; outcome: string }[];
  milestones: Record<
    'respondedAt' | 'screeningAt' | 'interviewAt' | 'offerAt' | 'closedAt',
    string | null
  >;
}

export async function createApplication(
  agent: Agent,
  body: Record<string, unknown> = {},
): Promise<App> {
  const res = await agent
    .post('/api/v1/applications')
    .send({ companyName: 'Acme Corp', title: 'Backend Engineer', status: 'applied', ...body })
    .expect(201);
  return data<App>(res);
}

// Walks an application through statuses, sending the version it last saw like a real client.
export async function moveTo(agent: Agent, appId: string, ...statuses: string[]): Promise<App> {
  let app = data<App>(await agent.get(`/api/v1/applications/${appId}`).expect(200));
  for (const to of statuses) {
    app = data<App>(
      await agent
        .post(`/api/v1/applications/${appId}/status`)
        .send({ to, version: app.version })
        .expect(200),
    );
  }
  return app;
}

export function sessionCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const cookies = res.headers['set-cookie'];
  const list = Array.isArray(cookies) ? (cookies as string[]) : [];
  return list.find((cookie) => cookie.startsWith('mc_session='));
}
