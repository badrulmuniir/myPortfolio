import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAppConfig } from '../../src/config/env.js';

const config = loadAppConfig({
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  FRONTEND_URL: ' http://localhost:5173/ , https://portfolio.example.com ',
  DATABASE_URL: 'postgres://user:db-pass-xyz@db.internal:5432/portfolio',
});

/** Fake db: only healthCheck is used by the endpoints built so far. */
const fakeDb = (healthCheck) => ({ healthCheck, query: async () => ({ rows: [] }) });
const healthyDb = fakeDb(async () => true);

describe('createApp', () => {
  it('requires config and db', () => {
    expect(() => createApp({ db: healthyDb })).toThrow(TypeError);
    expect(() => createApp({ config })).toThrow(TypeError);
  });

  it('accepts clock and hasher without using them yet', async () => {
    const app = createApp({ config, db: healthyDb, clock: { now: () => 0 }, hasher: {} });
    await request(app).get('/api/health').expect(200);
  });
});

describe('GET /api/health', () => {
  it('returns 200 with status ok when the database answers', async () => {
    const res = await request(createApp({ config, db: healthyDb })).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
  });

  it('returns 503 with a fixed Error_Response when the health check fails', async () => {
    const res = await request(createApp({ config, db: fakeDb(async () => false) })).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' },
    });
  });

  it('returns 503 without database details when the health check throws', async () => {
    const db = fakeDb(async () => {
      throw new Error('connect ECONNREFUSED db.internal:5432 for user with db-pass-xyz');
    });
    const res = await request(createApp({ config, db })).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    for (const leak of ['ECONNREFUSED', 'db.internal', 'db-pass-xyz', 'postgres://']) {
      expect(res.text).not.toContain(leak);
    }
  });

  it('ignores the Authorization header', async () => {
    const res = await request(createApp({ config, db: healthyDb }))
      .get('/api/health')
      .set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(200);
  });

  it('omits X-Powered-By on success and error responses', async () => {
    const ok = await request(createApp({ config, db: healthyDb })).get('/api/health');
    const down = await request(createApp({ config, db: fakeDb(async () => false) })).get('/api/health');
    expect(ok.headers['x-powered-by']).toBeUndefined();
    expect(down.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  const app = createApp({ config, db: healthyDb });

  it('echoes a matching Origin on a simple request and sets Vary: Origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers.vary).toMatch(/Origin/);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    // Preflight-only headers are not sent on simple requests.
    expect(res.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('matches every configured origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://portfolio.example.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://portfolio.example.com');
  });

  it('answers a preflight from a matching Origin with 204 and the allow headers', async () => {
    const res = await request(app)
      .options('/api/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PUT,PATCH,DELETE');
    expect(res.headers['access-control-allow-headers']).toBe('Authorization, Content-Type');
    expect(res.headers['access-control-max-age']).toBe('600');
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it.each([
    'http://evil.example.com',
    'http://localhost:5174',
    'https://localhost:5173',
    'http://localhost:5173.evil.com',
    'https://sub.portfolio.example.com',
    'null',
  ])('sends no allow headers for the non-matching Origin %s', async (origin) => {
    const get = await request(app).get('/api/health').set('Origin', origin);
    expect(get.status).toBe(200);
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
    expect(get.headers.vary).toMatch(/Origin/);

    const preflight = await request(app)
      .options('/api/health')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'DELETE');
    expect(preflight.status).toBe(204);
    for (const header of [
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
      'access-control-max-age',
    ]) {
      expect(preflight.headers[header]).toBeUndefined();
    }
  });

  it('passes requests without an Origin header through unchanged', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
