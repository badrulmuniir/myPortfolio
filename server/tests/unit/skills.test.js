// Skill endpoints with a fake db (Requirements 15.1, 15.2, 15.3, 15.7, 15.8, 4.10, 7.1).
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { adminOnly } from '../../src/middleware/auth.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createSkillRouter } from '../../src/routes/skill.routes.js';
import { SQL } from '../../src/services/skillService.js';

const config = loadAppConfig({
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});
const silent = { info() {}, warn() {}, error() {} };

/** Stub admin protection: marks the request as authenticated. */
const stubAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];

/** Fake db backed by a Map of skills; records every statement it receives. */
function fakeDb(skills = []) {
  const rows = new Map(skills.map((s) => [s.id, { ...s }]));
  let nextId = Math.max(0, ...rows.keys()) + 1;
  const calls = [];
  return {
    rows,
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      if (text === SQL.list) return { rows: [...rows.values()].map((r) => ({ ...r })) };
      if (text === SQL.create) {
        const [name, category, proficiency_level, icon_url, display_order] = params;
        const row = { id: nextId++, name, category, proficiency_level, icon_url, display_order };
        rows.set(row.id, row);
        return { rows: [{ ...row }] };
      }
      if (text === SQL.update) {
        const [id, name, category, proficiency_level, icon_url, display_order] = params;
        if (!rows.has(id)) return { rows: [] };
        const row = { id, name, category, proficiency_level, icon_url, display_order };
        rows.set(id, row);
        return { rows: [{ ...row }] };
      }
      if (text === SQL.remove) {
        const [id] = params;
        return { rows: rows.delete(id) ? [{ id }] : [] };
      }
      throw new Error(`unexpected query ${text}`);
    },
  };
}

function setup({ db = fakeDb(), requireAdmin = stubAdmin } = {}) {
  const app = express();
  app.use(jsonBody);
  app.use('/api', createSkillRouter({ db, config, requireAdmin }));
  app.use(createErrorHandler({ logger: silent }));
  return { app, db };
}

const writes = (db) => db.calls.filter((c) => c.text !== SQL.list);

const valid = { name: 'React', category: 'Frontend Development', proficiency_level: 'Advanced', icon_url: 'https://example.com/react.svg', display_order: 1 };
const stored = { id: 3, ...valid };

describe('GET /api/skills', () => {
  it('orders by lower(category), display_order, lower(name), id in code-point order', () => {
    const order = SQL.list.replace(/\s+/g, ' ').split('ORDER BY ')[1];
    expect(order).toBe('lower(category) COLLATE "C" ASC, display_order ASC, lower(name) COLLATE "C" ASC, id ASC');
  });

  it('returns the rows from the Database in the order received', async () => {
    const skills = [
      { id: 2, name: 'PostgreSQL', category: 'Database', proficiency_level: '', icon_url: '', display_order: 0 },
      { id: 1, name: 'React', category: 'frontend', proficiency_level: 'Expert', icon_url: '', display_order: 0 },
    ];
    const { app } = setup({ db: fakeDb(skills) });
    const res = await request(app).get('/api/skills');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: skills });
  });

  it('returns an empty list when no skills exist', async () => {
    const res = await request(setup().app).get('/api/skills');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('is public: no admin middleware runs', async () => {
    const { app } = setup({ requireAdmin: [(req, res) => res.status(418).end()] });
    expect((await request(app).get('/api/skills').set('Authorization', 'Bearer garbage')).status).toBe(200);
  });
});

describe('POST /api/skills', () => {
  it('creates the skill and returns 201 with the stored fields', async () => {
    const { app, db } = setup();
    const res = await request(app).post('/api/skills').send({ ...valid, name: '  React  ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { id: 1, ...valid } });
    expect(db.calls).toEqual([{ text: SQL.create, params: ['React', 'Frontend Development', 'Advanced', 'https://example.com/react.svg', 1] }]);
  });

  it('stores omitted optional fields as empty strings', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/skills').send({ name: 'Git', category: 'Development Tools', display_order: 0 });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ id: 1, name: 'Git', category: 'Development Tools', proficiency_level: '', icon_url: '', display_order: 0 });
  });

  it.each([
    ['a decimal display_order', { display_order: 1.5 }, ['display_order']],
    ['a numeric-string display_order', { display_order: '1' }, ['display_order']],
    ['display_order above 9999', { display_order: 10000 }, ['display_order']],
    ['a lowercase proficiency level', { proficiency_level: 'advanced' }, ['proficiency_level']],
    ['a javascript: icon URL', { icon_url: 'javascript:alert(1)' }, ['icon_url']],
    ['a blank name', { name: '   ' }, ['name']],
    ['a 51-character category', { category: 'x'.repeat(51) }, ['category']],
    ['an unknown field', { id: 9 }, ['id']],
  ])('returns 400 for %s with no write', async (_name, change, fields) => {
    const { app, db } = setup();
    const res = await request(app).post('/api/skills').send({ ...valid, ...change });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toEqual(fields);
    expect(writes(db)).toEqual([]);
  });

  it('reports every missing required field', async () => {
    const { app, db } = setup();
    const res = await request(app).post('/api/skills').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['category', 'display_order', 'name']);
    expect(writes(db)).toEqual([]);
  });
});

describe('PUT /api/skills/:id', () => {
  it('replaces every field and returns 200 with the updated skill', async () => {
    const { app, db } = setup({ db: fakeDb([stored]) });
    const res = await request(app).put('/api/skills/3').send({ name: 'Vue', category: 'Frontend Development', display_order: 4 });
    expect(res.status).toBe(200);
    // Omitted optional fields are set to empty (15.7).
    const updated = { id: 3, name: 'Vue', category: 'Frontend Development', proficiency_level: '', icon_url: '', display_order: 4 };
    expect(res.body).toEqual({ success: true, data: updated });
    expect(db.rows.get(3)).toEqual(updated);
  });

  it('returns 404 NOT_FOUND for an unknown id', async () => {
    const { app, db } = setup({ db: fakeDb([stored]) });
    const res = await request(app).put('/api/skills/99').send(valid);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Skill not found' } });
    expect(db.rows.get(3)).toEqual(stored);
  });

  it('returns 400 INVALID_ID for a non-numeric id before validating the body', async () => {
    const { app, db } = setup({ db: fakeDb([stored]) });
    const res = await request(app).put('/api/skills/abc').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
    expect(db.calls).toEqual([]);
  });

  it('returns 400 for an invalid body and leaves the skill unchanged', async () => {
    const { app, db } = setup({ db: fakeDb([stored]) });
    const res = await request(app).put('/api/skills/3').send({ ...valid, display_order: 2.5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(db.calls).toEqual([]);
    expect(db.rows.get(3)).toEqual(stored);
  });
});

describe('DELETE /api/skills/:id', () => {
  it('deletes the skill and returns 200 with its id', async () => {
    const { app, db } = setup({ db: fakeDb([stored]) });
    const res = await request(app).delete('/api/skills/3');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 3 } });
    expect(db.rows.has(3)).toBe(false);
  });

  it('returns 404 NOT_FOUND for an unknown id', async () => {
    const { app, db } = setup({ db: fakeDb([stored]) });
    const res = await request(app).delete('/api/skills/4');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(db.rows.has(3)).toBe(true);
  });

  it.each(['abc', '0', '-1', '2147483648'])('returns 400 INVALID_ID for id %j', async (id) => {
    const { app, db } = setup({ db: fakeDb([stored]) });
    const res = await request(app).delete(`/api/skills/${id}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
    expect(db.calls).toEqual([]);
  });
});

describe('admin protection with the real Auth_Middleware', () => {
  // The real adminOnly pair; without a token it rejects before any skill query.
  const real = (db) => setup({ db, requireAdmin: adminOnly({ db, config }) });

  it.each([
    ['POST', '/api/skills'],
    ['PUT', '/api/skills/3'],
    ['PUT', '/api/skills/abc'],
    ['DELETE', '/api/skills/3'],
  ])('%s %s returns 401 without a token', async (method, path) => {
    const db = fakeDb([stored]);
    const { app } = real(db);
    const res = await request(app)[method.toLowerCase()](path).send(valid);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(db.calls).toEqual([]);
    expect(db.rows.get(3)).toEqual(stored);
  });

  it('GET /api/skills needs no token', async () => {
    const { app } = real(fakeDb([stored]));
    expect((await request(app).get('/api/skills')).status).toBe(200);
  });
});
