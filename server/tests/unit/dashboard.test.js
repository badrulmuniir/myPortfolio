// Dashboard stats endpoint with a fake db (Requirements 20.1, 20.4, 20.5, 20.6, 7.1).
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { adminOnly } from '../../src/middleware/auth.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createDashboardRouter } from '../../src/routes/dashboard.routes.js';
import { SQL as AUTH_SQL } from '../../src/services/authService.js';
import { SQL, STAT_KEYS } from '../../src/services/dashboardService.js';

const SECRET = 'unit-test-secret-that-is-at-least-32-chars';
const config = loadAppConfig({
  JWT_SECRET: SECRET,
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});
const silent = { info() {}, warn() {}, error() {} };

const stubAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];

const COUNTS = {
  projects_total: 2,
  projects_published: 1,
  skills: 5,
  experiences: 3,
  education: 0,
  messages_total: 3,
  messages_unread: 2,
};

/** Fake db: answers the stats statement and the admin lookup; records every statement. */
function fakeDb({ row = COUNTS, fail = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      if (text === AUTH_SQL.findById) return { rows: [{ id: 1, email: 'owner@example.com', role: 'admin' }] };
      if (text === SQL.stats) {
        if (fail) throw fail;
        return { rows: [{ ...row }] };
      }
      throw new Error(`unexpected query ${text}`);
    },
  };
}

function setup({ db = fakeDb(), requireAdmin = stubAdmin } = {}) {
  const app = express();
  app.use(jsonBody);
  app.use('/api', createDashboardRouter({ db, config, requireAdmin }));
  app.use(createErrorHandler({ logger: silent }));
  return { app, db };
}

const statsCalls = (db) => db.calls.filter((c) => c.text === SQL.stats);

describe('dashboard stats SQL', () => {
  it('is one statement with seven count(*)::int subqueries, one per key', () => {
    expect(SQL.stats.match(/\(SELECT count\(\*\)::int FROM/g)).toHaveLength(7);
    for (const key of STAT_KEYS) expect(SQL.stats).toMatch(new RegExp(`AS ${key}\\b`));
    expect(SQL.stats).toMatch(/FROM projects WHERE is_published\)/);
    expect(SQL.stats).toMatch(/FROM contact_messages WHERE NOT is_read\)/);
  });
});

describe('GET /api/dashboard/stats', () => {
  it('returns 200 with exactly the seven integer counts from one query', async () => {
    const { app, db } = setup();
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: COUNTS });
    expect(Object.keys(res.body.data)).toEqual([...STAT_KEYS]);
    for (const value of Object.values(res.body.data)) expect(Number.isInteger(value)).toBe(true);
    expect(db.calls).toEqual([{ text: SQL.stats, params: [] }]);
  });

  it('includes counts of 0 and drops any extra column', async () => {
    const zeros = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
    const { app } = setup({ db: fakeDb({ row: { ...zeros, extra: 9 } }) });
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(zeros);
  });

  it('returns a generic 500 with no counts when the query fails', async () => {
    const fail = new Error('relation "skills" does not exist: SELECT count(*) FROM skills');
    const { app } = setup({ db: fakeDb({ fail }) });
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });
});

describe('admin protection with the real Auth_Middleware', () => {
  const real = (db) => setup({ db, requireAdmin: adminOnly({ db, config }) });
  const NOW = Math.floor(Date.now() / 1000);
  const token = (claims = {}) =>
    jwt.sign({ sub: '1', email: 'owner@example.com', role: 'admin', iat: NOW, exp: NOW + 3600, ...claims }, SECRET, {
      algorithm: 'HS256',
    });

  it('returns 401 without a token and runs no count query', async () => {
    const db = fakeDb();
    const res = await request(real(db).app).get('/api/dashboard/stats');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.data).toBeUndefined();
    expect(db.calls).toEqual([]);
  });

  it('returns 401 for an invalid token', async () => {
    const db = fakeDb();
    const res = await request(real(db).app).get('/api/dashboard/stats').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
    expect(statsCalls(db)).toEqual([]);
  });

  it('returns 403 for a token whose role is not admin and runs no count query', async () => {
    const db = fakeDb();
    const res = await request(real(db).app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token({ role: 'editor' })}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.data).toBeUndefined();
    expect(statsCalls(db)).toEqual([]);
  });

  it('returns 200 for a valid admin token', async () => {
    const db = fakeDb();
    const res = await request(real(db).app).get('/api/dashboard/stats').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(COUNTS);
  });
});
