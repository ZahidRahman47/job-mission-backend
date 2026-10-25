// Request pipeline: health, error envelope, request IDs, CSRF, CORS, body limits, security headers, docs.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, CSRF_HEADERS } from './helpers.ts';

describe('health checks', () => {
  it('reports liveness without touching dependencies', async () => {
    const res = await request(app).get('/api/v1/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports readiness when the database answers', async () => {
    const res = await request(app).get('/api/v1/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });
});

describe('error envelope and request IDs', () => {
  it('returns ROUTE_NOT_FOUND in the standard envelope with the request ID', async () => {
    const res = await request(app).get('/api/v1/nope').expect(404);
    const requestId = res.headers['x-request-id'];
    expect(res.body).toEqual({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route GET /api/v1/nope not found.',
        requestId,
      },
    });
  });

  it('echoes a well-formed incoming X-Request-Id', async () => {
    const res = await request(app).get('/api/v1/health/live').set('X-Request-Id', 'trace-abc_123');
    expect(res.headers['x-request-id']).toBe('trace-abc_123');
  });

  it('replaces a malformed incoming X-Request-Id', async () => {
    const res = await request(app)
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'bad id with spaces <script>');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects malformed JSON with MALFORMED_REQUEST', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF_HEADERS)
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('MALFORMED_REQUEST');
  });

  it('rejects bodies over 100 KB with PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF_HEADERS)
      .send({ email: 'a@example.com', password: 'x'.repeat(110 * 1024) })
      .expect(413);
    expect((res.body as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('CSRF guard', () => {
  it('rejects a write without the X-Requested-With header', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@example.com', password: 'whatever' })
      .expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('CSRF_REJECTED');
  });

  it('rejects a write from a foreign origin even with the header', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF_HEADERS)
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@example.com', password: 'whatever' })
      .expect(403);
  });

  it('lets a write from the allowed frontend origin through to validation', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF_HEADERS)
      .set('Origin', 'http://localhost:3000')
      .send({})
      .expect(400);
  });

  it('does not apply to reads', async () => {
    await request(app).get('/api/v1/health/live').expect(200);
  });
});

describe('CORS and security headers', () => {
  it('allows the frontend origin with credentials', async () => {
    const res = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('never allows an unknown origin', async () => {
    const res = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/v1/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('API docs', () => {
  it('serves the OpenAPI document with every auth route', async () => {
    const res = await request(app).get('/api/v1/openapi.json').expect(200);
    const paths = Object.keys((res.body as { paths: Record<string, unknown> }).paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/auth/register',
        '/auth/login',
        '/auth/logout',
        '/auth/logout-all',
        '/auth/verify-email',
        '/auth/verify-email/resend',
        '/auth/password/forgot',
        '/auth/password/reset',
        '/auth/password/change',
        '/users/me',
        '/users/me/sessions',
        '/users/me/sessions/{sessionId}',
      ]),
    );
  });
});
