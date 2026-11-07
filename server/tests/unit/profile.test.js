// Profile endpoints with a fake db (Requirements 9.1, 10.1, 10.2, 10.3, 10.4, 10.5, 10.10, 10.12).
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createProfileRouter } from '../../src/routes/profile.routes.js';
import { SQL as AUTH_SQL } from '../../src/services/authService.js';
import { SQL, buildUpdate } from '../../src/services/profileService.js';
import { PROFILE_FIELDS } from '../../src/validators/profile.schemas.js';

const SECRET = 'unit-test-secret-that-is-at-least-32-chars';
const config = loadAppConfig({
  JWT_SECRET: SECRET,
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});
const silent = { info() {}, warn() {}, error() {} };
const stubAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'a@example.com', role: 'admin' };
    next();
  },
];

const STORED = Object.freeze({
  name: 'Ada Lovelace',
  professional_title: 'Engineer',
  personal_introduction: 'Hi',
  biography: 'Bio',
  career_interests: '',
  professional_goals: '',
  profile_image_url: 'https://example.com/me.png',
  email: 'ada@example.com',
  github_url: 'https://github.com/ada',
  linkedin_url: '',
});

/**
 * Fake db holding the profile row (or none). It understands SQL.get and the UPDATE statements
 * built by buildUpdate, and records every query.
 */
function fakeDb(row = { id: 1, ...STORED, created_at: new Date(0), updated_at: new Date(0) }) {
  const state = { row: row && { ...row }, queries: [] };
  state.query = async (text, params = []) => {
    state.queries.push({ text, params });
    if (text === SQL.get) return { rows: state.row ? [{ ...state.row }] : [] };
    const m = /^UPDATE profile SET (.+) WHERE id = 1 RETURNING /.exec(text);
    if (m) {
      if (!state.row) return { rows: [] };
      const columns = m[1].split(', ').map((a) => a.split(' = ')[0]);
      columns.forEach((c, i) => {
        state.row[c] = params[i];
      });
      return { rows: [{ ...state.row }] };
    }
    if (text === AUTH_SQL.findById) return { rows: [{ id: 1, email: 'a@example.com', role: 'admin' }] };
    throw new Error(`unexpected query ${text}`);
  };
  return state;
}

function buildApp(db, { requireAdmin = stubAdmin } = {}) {
  const app = express();
  app.use(jsonBody);
  app.use('/api', createProfileRouter({ db, config, requireAdmin }));
  app.use(createErrorHandler({ logger: silent }));
  return app;
}

const validBody = { name: 'Grace', professional_title: 'Admiral', email: 'grace@example.com' };
const updates = (db) => db.queries.filter((q) => q.text.startsWith('UPDATE'));

describe('buildUpdate', () => {
  it('sets only the submitted allow-listed columns with bind parameters', () => {
    const stmt = buildUpdate({ name: 'N', email: 'e@example.com', 'x; DROP TABLE profile': 'y' });
    expect(stmt.text).toBe(
      `UPDATE profile SET name = $1, email = $2 WHERE id = 1 RETURNING ${PROFILE_FIELDS.join(', ')}`,
    );
    expect(stmt.values).toEqual(['N', 'e@example.com']);
  });

  it('returns null when no Profile field is present', () => {
    expect(buildUpdate({})).toBeNull();
  });
});

describe('GET /api/profile', () => {
  it('returns exactly the ten Profile fields', async () => {
    const res = await request(buildApp(fakeDb())).get('/api/profile');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: STORED });
    expect(Object.keys(res.body.data)).toEqual([...PROFILE_FIELDS]);
  });

  it('is public and ignores the Authorization header', async () => {
    const app = buildApp(fakeDb(), { requireAdmin: [(req, res, next) => next(new Error('must not run'))] });
    const res = await request(app).get('/api/profile').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(200);
  });

  it('returns 404 NOT_FOUND when the Profile row is missing', async () => {
    const db = fakeDb(null);
    const res = await request(buildApp(db)).get('/api/profile');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Profile not found' } });
    expect(db.queries.every((q) => q.text.startsWith('SELECT'))).toBe(true);
  });
});

describe('PUT /api/profile', () => {
  it('stores trimmed values and returns the ten fields as stored', async () => {
    const db = fakeDb();
    const res = await request(buildApp(db))
      .put('/api/profile')
      .send({ name: '  Grace  ', professional_title: ' Admiral ', email: ' grace@example.com ', biography: ' New bio ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      ...STORED,
      name: 'Grace',
      professional_title: 'Admiral',
      email: 'grace@example.com',
      biography: 'New bio',
    });
    expect(Object.keys(res.body.data)).toEqual([...PROFILE_FIELDS]);
  });

  it('updates only the submitted columns in one statement, leaving omitted fields unchanged', async () => {
    const db = fakeDb();
    await request(buildApp(db)).put('/api/profile').send({ ...validBody, github_url: '' });
    const [stmt, ...rest] = updates(db);
    expect(rest).toEqual([]);
    expect(stmt.text).toMatch(/^UPDATE profile SET name = \$1, professional_title = \$2, email = \$3, github_url = \$4 WHERE id = 1/);
    expect(stmt.params).toEqual(['Grace', 'Admiral', 'grace@example.com', '']);
    expect(db.row.biography).toBe('Bio');
    expect(db.row.github_url).toBe('');
  });

  it.each([
    ['a missing name', { professional_title: 'T', email: 'e@example.com' }, ['name']],
    ['a whitespace-only title', { ...validBody, professional_title: '   ' }, ['professional_title']],
    ['an invalid email', { ...validBody, email: 'not-an-email' }, ['email']],
    ['a too-long biography', { ...validBody, biography: 'x'.repeat(5001) }, ['biography']],
    ['a javascript: URL', { ...validBody, github_url: 'javascript:alert(1)' }, ['github_url']],
    ['an unknown field', { ...validBody, id: 2 }, ['id']],
    ['several invalid fields', { email: 'bad', linkedin_url: 'ftp://x.y' }, ['name', 'professional_title', 'email', 'linkedin_url']],
  ])('returns 400 for %s with details and no write', async (_name, body, fields) => {
    const db = fakeDb();
    const res = await request(buildApp(db)).put('/api/profile').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual([...fields].sort());
    expect(db.queries).toEqual([]);
  });

  it('returns 404 and creates no row when the Profile row is missing', async () => {
    const db = fakeDb(null);
    const res = await request(buildApp(db)).put('/api/profile').send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Profile not found' });
    expect(db.queries.some((q) => /INSERT/i.test(q.text))).toBe(false);
    expect(db.row).toBeNull();
  });

  describe('with the real admin protection', () => {
    const NOW = Math.floor(Date.now() / 1000);
    const token = (claims = {}) =>
      jwt.sign({ sub: '1', email: 'a@example.com', role: 'admin', iat: NOW, exp: NOW + 3600, ...claims }, SECRET, {
        algorithm: 'HS256',
      });
    // requireAdmin omitted: the router builds adminOnly({ db, config }) itself.
    const realApp = (db) => {
      const app = express();
      app.use(jsonBody);
      app.use('/api', createProfileRouter({ db, config }));
      app.use(createErrorHandler({ logger: silent }));
      return app;
    };

    it('returns 401 without a token, before validation, and writes nothing', async () => {
      const db = fakeDb();
      const res = await request(realApp(db)).put('/api/profile').send({ nope: true });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(db.queries).toEqual([]);
    });

    it('returns 403 for a non-admin role', async () => {
      const db = fakeDb();
      const res = await request(realApp(db))
        .put('/api/profile')
        .set('Authorization', `Bearer ${token({ role: 'editor' })}`)
        .send(validBody);
      expect(res.status).toBe(403);
      expect(updates(db)).toEqual([]);
    });

    it('accepts a valid admin token', async () => {
      const db = fakeDb();
      const res = await request(realApp(db))
        .put('/api/profile')
        .set('Authorization', `Bearer ${token()}`)
        .send(validBody);
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Grace');
    });
  });
});
