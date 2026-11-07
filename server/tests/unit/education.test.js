// Education endpoints with a fake db and a fixed clock (Requirements 17.1–17.6).
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createEducationRouter } from '../../src/routes/education.routes.js';
import { SQL } from '../../src/services/educationService.js';

const config = loadAppConfig({
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});
/** 2025-06-15 UTC, so the year bound is 2035. */
const clock = { now: () => Date.UTC(2025, 5, 15) };
const silent = { info() {}, warn() {}, error() {} };

/** In-memory `education` table answering exactly the service's statements. */
function fakeDb(initial = []) {
  const rows = initial.map((r) => ({ ...r }));
  let nextId = rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const calls = [];
  const fields = ['institution', 'qualification', 'field_of_study', 'start_year', 'end_year', 'description'];
  const fromParams = (p) => Object.fromEntries(fields.map((f, i) => [f, p[i]]));
  return {
    rows,
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      if (text === SQL.list) return { rows: rows.map((r) => ({ ...r })) };
      if (text === SQL.create) {
        const row = { id: nextId++, ...fromParams(params) };
        rows.push(row);
        return { rows: [{ ...row }] };
      }
      if (text === SQL.update) {
        const row = rows.find((r) => r.id === params[0]);
        if (!row) return { rows: [] };
        Object.assign(row, fromParams(params.slice(1)));
        return { rows: [{ ...row }] };
      }
      if (text === SQL.remove) {
        const i = rows.findIndex((r) => r.id === params[0]);
        if (i === -1) return { rows: [] };
        const [removed] = rows.splice(i, 1);
        return { rows: [{ id: removed.id }] };
      }
      throw new Error(`unexpected query ${text}`);
    },
  };
}

const stubAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];

function setup({ db = fakeDb(), requireAdmin = stubAdmin } = {}) {
  const app = express();
  app.use(jsonBody);
  const deps = { db, config, clock, logger: silent };
  if (requireAdmin) deps.requireAdmin = requireAdmin;
  app.use('/api', createEducationRouter(deps));
  app.use(createErrorHandler({ logger: silent }));
  return { app, db };
}

const stored = {
  id: 1,
  institution: 'University A',
  qualification: 'BSc',
  field_of_study: 'Computer Science',
  start_year: 2018,
  end_year: 2022,
  description: 'Graduated with honours',
};

const valid = { institution: '  Uni B ', qualification: 'MSc', start_year: 2023, end_year: 2025 };

function fieldsOf(res) {
  return res.body.error.details.map((d) => d.field);
}

describe('GET /api/education', () => {
  it('orders by start year desc, end year desc nulls first, then id', () => {
    expect(SQL.list).toMatch(/ORDER BY start_year DESC, end_year DESC NULLS FIRST, id ASC$/);
  });

  it('returns an empty list when there are no records', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/education');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('returns every record with exactly the Education fields, without authentication', async () => {
    const { app } = setup({ db: fakeDb([{ ...stored, end_year: null }]), requireAdmin: null });
    const res = await request(app).get('/api/education').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ ...stored, end_year: null }]);
  });
});

describe('POST /api/education', () => {
  it('creates a record with trimmed values and defaults, returning 201', async () => {
    const { app, db } = setup();
    const res = await request(app).post('/api/education').send(valid);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: {
        id: 1,
        institution: 'Uni B',
        qualification: 'MSc',
        field_of_study: '',
        start_year: 2023,
        end_year: 2025,
        description: '',
      },
    });
    expect(db.rows).toHaveLength(1);
  });

  it('stores an empty end year as null', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/education').send({ ...valid, end_year: '' });
    expect(res.status).toBe(201);
    expect(res.body.data.end_year).toBeNull();
  });

  it('accepts an end year equal to the start year and the year bound Y+10', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/education').send({ ...valid, end_year: 2023 })).status).toBe(201);
    expect((await request(app).post('/api/education').send({ ...valid, start_year: 2035, end_year: 2035 })).status).toBe(201);
  });

  it.each([
    ['an end year before the start year', { end_year: 2022 }, 'end_year'],
    ['an end year after the current year plus 10', { end_year: 2036 }, 'end_year'],
    ['a non-integer end year', { end_year: 2024.5 }, 'end_year'],
    ['a numeric-string end year', { end_year: '2024' }, 'end_year'],
    ['a start year before 1950', { start_year: 1949, end_year: null }, 'start_year'],
    ['a start year after the current year plus 10', { start_year: 2036, end_year: null }, 'start_year'],
    ['a non-integer start year', { start_year: '2023' }, 'start_year'],
    ['an empty institution', { institution: '   ' }, 'institution'],
    ['a too-long qualification', { qualification: 'q'.repeat(151) }, 'qualification'],
    ['a too-long field of study', { field_of_study: 'f'.repeat(151) }, 'field_of_study'],
    ['a too-long description', { description: 'd'.repeat(5001) }, 'description'],
    ['an unknown field', { id: 99 }, 'id'],
  ])('rejects %s with 400 on that field and stores nothing', async (_name, patch, field) => {
    const { app, db } = setup();
    const res = await request(app).post('/api/education').send({ ...valid, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(fieldsOf(res)).toEqual([field]);
    expect(db.calls).toEqual([]);
  });

  it('reports every missing required field', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/education').send({});
    expect(res.status).toBe(400);
    expect(fieldsOf(res).sort()).toEqual(['institution', 'qualification', 'start_year']);
  });
});

describe('PUT /api/education/:id', () => {
  it('replaces all fields, setting omitted optional fields to empty or null', async () => {
    const { app, db } = setup({ db: fakeDb([stored]) });
    const res = await request(app)
      .put('/api/education/1')
      .send({ institution: 'New Uni', qualification: 'PhD', start_year: 2024 });
    expect(res.status).toBe(200);
    const expected = {
      id: 1,
      institution: 'New Uni',
      qualification: 'PhD',
      field_of_study: '',
      start_year: 2024,
      end_year: null,
      description: '',
    };
    expect(res.body).toEqual({ success: true, data: expected });
    expect(db.rows).toEqual([expected]);
  });

  it('returns 404 for an unknown id and changes nothing', async () => {
    const { app, db } = setup({ db: fakeDb([stored]) });
    const res = await request(app).put('/api/education/2').send(valid);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Education not found' } });
    expect(db.rows).toEqual([stored]);
  });

  it.each(['abc', '0', '-1', '1.5', '2147483648'])('returns 400 INVALID_ID for id %j before validating the body', async (id) => {
    const { app, db } = setup({ db: fakeDb([stored]) });
    const res = await request(app).put(`/api/education/${id}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
    expect(db.calls).toEqual([]);
  });

  it('returns 400 on end_year when it is before the start year', async () => {
    const { app, db } = setup({ db: fakeDb([stored]) });
    const res = await request(app).put('/api/education/1').send({ ...valid, start_year: 2020, end_year: 2019 });
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toEqual(['end_year']);
    expect(db.rows).toEqual([stored]);
  });
});

describe('DELETE /api/education/:id', () => {
  it('deletes the record and returns { id }', async () => {
    const { app, db } = setup({ db: fakeDb([stored]) });
    const res = await request(app).delete('/api/education/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 1 } });
    expect(db.rows).toEqual([]);
    expect((await request(app).get('/api/education')).body.data).toEqual([]);
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = setup({ db: fakeDb([stored]) });
    const res = await request(app).delete('/api/education/5');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 INVALID_ID for a malformed id', async () => {
    const { app } = setup();
    expect((await request(app).delete('/api/education/x1')).body.error.code).toBe('INVALID_ID');
  });
});

describe('admin protection with the real adminOnly', () => {
  it.each([
    ['post', '/api/education'],
    ['put', '/api/education/abc'],
    ['delete', '/api/education/1'],
  ])('%s %s without a token returns 401 and runs no query', async (method, path) => {
    const db = fakeDb([stored]);
    const { app } = setup({ db, requireAdmin: null });
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(db.calls).toEqual([]);
  });
});
