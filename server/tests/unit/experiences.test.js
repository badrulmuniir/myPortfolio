// Experience endpoints with a fake db (Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.8,
// 16.9, 16.10). The fake keeps rows in memory and applies the SQL built by the service, so the
// tests check both the HTTP behavior and the statements sent to the Database.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createExperienceRouter } from '../../src/routes/experience.routes.js';
import {
  END_AFTER_START_CONSTRAINT,
  SQL,
  buildUpdate,
  createExperienceService,
} from '../../src/services/experienceService.js';
import { ValidationError } from '../../src/utils/errors.js';

const config = loadAppConfig({
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});

const silent = { info() {}, warn() {}, error() {} };
const DEFAULTS = { end_date: null, description: '', responsibilities: [] };

const clone = (row) => ({ ...row, responsibilities: [...row.responsibilities] });

function checkViolation() {
  return Object.assign(new Error('new row violates check constraint'), {
    code: '23514',
    constraint: END_AFTER_START_CONSTRAINT,
  });
}

/** Placeholder number of `$3::date` → 3. */
const paramIndex = (placeholder) => Number(/^\$(\d+)/.exec(placeholder)[1]) - 1;

/** In-memory experiences table that understands the statements built by experienceService. */
function fakeDb(initial = []) {
  const rows = new Map(initial.map((r) => [r.id, { ...DEFAULTS, ...r }]));
  let nextId = Math.max(0, ...initial.map((r) => r.id)) + 1;
  const queries = [];
  const enforce = (row) => {
    if (row.end_date !== null && row.end_date < row.start_date) throw checkViolation();
  };

  async function exec(text, params = []) {
    queries.push({ text, params });
    if (text === SQL.list) return { rows: [...rows.values()].map(clone) };
    if (text === SQL.lockById || text === SQL.getById) {
      const row = rows.get(params[0]);
      return { rows: row ? [clone(row)] : [] };
    }
    if (text === SQL.remove) {
      if (!rows.has(params[0])) return { rows: [] };
      rows.delete(params[0]);
      return { rows: [{ id: params[0] }] };
    }
    let m = /^INSERT INTO experiences \(([^)]+)\) VALUES \(([^)]+)\)/.exec(text);
    if (m) {
      const row = { ...DEFAULTS, id: nextId };
      const placeholders = m[2].split(', ');
      m[1].split(', ').forEach((column, i) => {
        row[column] = params[paramIndex(placeholders[i])];
      });
      enforce(row);
      nextId += 1;
      rows.set(row.id, row);
      return { rows: [clone(row)] };
    }
    m = /^UPDATE experiences SET (.+) WHERE id = \$1 RETURNING/.exec(text);
    if (m) {
      const current = rows.get(params[0]);
      if (!current) return { rows: [] };
      const row = { ...current };
      for (const assignment of m[1].split(', ')) {
        const [column, placeholder] = assignment.split(' = ');
        row[column] = params[paramIndex(placeholder)];
      }
      enforce(row);
      rows.set(row.id, row);
      return { rows: [clone(row)] };
    }
    throw new Error(`unexpected query: ${text}`);
  }

  return {
    rows,
    queries,
    query: exec,
    withTransaction: async (work) => work(Object.freeze({ query: exec })),
    healthCheck: async () => true,
    writes: () => queries.filter((q) => /^(INSERT|UPDATE|DELETE)/.test(q.text)),
  };
}

const stubAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];

function setup(initial = [], { requireAdmin = stubAdmin } = {}) {
  const db = fakeDb(initial);
  const app = express();
  app.use(jsonBody);
  app.use('/api', createExperienceRouter({ db, config, requireAdmin, logger: silent }));
  app.use(createErrorHandler({ logger: silent }));
  return { app, db };
}

const STORED = {
  id: 3,
  job_title: 'Engineer',
  company_name: 'Acme',
  employment_type: 'Full-time',
  start_date: '2020-01-01',
  end_date: '2021-06-30',
  description: 'Old description',
  responsibilities: ['first', 'second'],
};

const valid = (overrides = {}) => ({
  job_title: '  Backend Developer ',
  company_name: 'Initech',
  employment_type: 'Contract',
  start_date: '2023-03-01',
  ...overrides,
});

const fields = (res) => res.body.error.details.map((d) => d.field).sort();

describe('GET /api/experiences', () => {
  it('returns an empty list when no records exist', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/experiences');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('returns every record with its responsibilities, using the documented order', async () => {
    const { app, db } = setup([STORED]);
    const res = await request(app).get('/api/experiences');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([STORED]);
    expect(db.queries).toEqual([{ text: SQL.list, params: [] }]);
    expect(SQL.list).toMatch(/ORDER BY start_date DESC, id DESC$/);
  });

  it('is public: it runs without admin middleware', async () => {
    const deny = [(req, res, next) => next(new Error('admin middleware must not run'))];
    const { app } = setup([STORED], { requireAdmin: deny });
    expect((await request(app).get('/api/experiences')).status).toBe(200);
  });
});

describe('POST /api/experiences', () => {
  it('creates a record and returns 201 with trimmed values', async () => {
    const { app, db } = setup();
    const res = await request(app)
      .post('/api/experiences')
      .send(valid({ end_date: '2024-01-31', description: ' Did things ', responsibilities: [' b ', 'a'] }));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: {
        id: 1,
        job_title: 'Backend Developer',
        company_name: 'Initech',
        employment_type: 'Contract',
        start_date: '2023-03-01',
        end_date: '2024-01-31',
        description: 'Did things',
        responsibilities: ['b', 'a'],
      },
    });
    const [insert] = db.writes();
    expect(insert.text).toContain('::text[]');
    expect(insert.params).toContainEqual(['b', 'a']);
  });

  it('stores an empty end date as null and uses defaults for omitted optional fields', async () => {
    const { app, db } = setup();
    const res = await request(app).post('/api/experiences').send(valid({ end_date: '' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ end_date: null, description: '', responsibilities: [] });
    const [, columns] = /^INSERT INTO experiences \(([^)]+)\)/.exec(db.writes()[0].text);
    expect(columns).toBe('job_title, company_name, employment_type, start_date, end_date');
  });

  it('accepts an end date equal to the start date', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/experiences').send(valid({ end_date: '2023-03-01' }));
    expect(res.status).toBe(201);
  });

  it('rejects an end date before the start date with before_start and writes nothing', async () => {
    const { app, db } = setup();
    const res = await request(app).post('/api/experiences').send(valid({ end_date: '2023-02-28' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'end_date', reason: 'before_start' }),
    ]);
    expect(db.queries).toEqual([]);
  });

  it.each([
    ['an employment type outside the set', { employment_type: 'full-time' }, ['employment_type']],
    ['a date that does not exist', { start_date: '2024-02-30' }, ['start_date']],
    ['21 responsibilities', { responsibilities: Array.from({ length: 21 }, (_, i) => `r${i}`) }, ['responsibilities']],
    ['a whitespace-only responsibility', { responsibilities: ['ok', '   '] }, ['responsibilities[1]']],
    ['a non-text responsibility', { responsibilities: [5] }, ['responsibilities[0]']],
    ['an unknown field', { is_current: true }, ['is_current']],
    ['a 101-character job title', { job_title: 'x'.repeat(101) }, ['job_title']],
  ])('returns 400 for %s and writes nothing', async (_name, overrides, expected) => {
    const { app, db } = setup();
    const res = await request(app).post('/api/experiences').send(valid(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(fields(res)).toEqual(expected);
    expect(db.queries).toEqual([]);
  });

  it('lists every missing required field', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/experiences').send({});
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(['company_name', 'employment_type', 'job_title', 'start_date']);
  });

  it('accepts exactly 20 responsibilities', async () => {
    const { app } = setup();
    const list = Array.from({ length: 20 }, (_, i) => `r${i}`);
    const res = await request(app).post('/api/experiences').send(valid({ responsibilities: list }));
    expect(res.status).toBe(201);
    expect(res.body.data.responsibilities).toEqual(list);
  });
});

describe('PUT /api/experiences/:id', () => {
  const required = {
    job_title: 'Senior Engineer',
    company_name: 'Acme',
    employment_type: 'Full-time',
    start_date: '2020-01-01',
  };

  it('replaces submitted fields, keeps omitted optional fields and replaces the whole list', async () => {
    const { app, db } = setup([STORED]);
    const res = await request(app)
      .put('/api/experiences/3')
      .send({ ...required, responsibilities: ['third', 'first'] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      ...STORED,
      job_title: 'Senior Engineer',
      responsibilities: ['third', 'first'],
    });
    const [update] = db.writes();
    expect(update.text).toBe(
      'UPDATE experiences SET job_title = $2, company_name = $3, employment_type = $4, start_date = $5::date, ' +
        'responsibilities = $6::text[] WHERE id = $1 RETURNING id, job_title, company_name, employment_type, ' +
        'start_date, end_date, description, responsibilities',
    );
    expect(update.params).toEqual([3, 'Senior Engineer', 'Acme', 'Full-time', '2020-01-01', ['third', 'first']]);
  });

  it('clears the end date when null or an empty string is submitted', async () => {
    const { app } = setup([STORED]);
    for (const end of [null, '']) {
      const res = await request(app).put('/api/experiences/3').send({ ...required, end_date: end });
      expect(res.status).toBe(200);
      expect(res.body.data.end_date).toBeNull();
    }
  });

  it('replaces responsibilities with an empty list when [] is submitted', async () => {
    const { app } = setup([STORED]);
    const res = await request(app).put('/api/experiences/3').send({ ...required, responsibilities: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.responsibilities).toEqual([]);
  });

  it('checks a new start date against the stored end date and writes nothing on failure', async () => {
    const { app, db } = setup([STORED]);
    const res = await request(app).put('/api/experiences/3').send({ ...required, start_date: '2022-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: [{ field: 'end_date', reason: 'before_start', message: 'End date must not be before the start date' }],
    });
    expect(db.writes()).toEqual([]);
    expect(db.rows.get(3)).toEqual(STORED);
  });

  it('accepts a new start date when the end date is cleared in the same request', async () => {
    const { app } = setup([STORED]);
    const res = await request(app)
      .put('/api/experiences/3')
      .send({ ...required, start_date: '2022-01-01', end_date: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ start_date: '2022-01-01', end_date: null });
  });

  it('returns 404 for an unknown id and writes nothing', async () => {
    const { app, db } = setup([STORED]);
    const res = await request(app).put('/api/experiences/99').send(required);
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Experience not found' });
    expect(db.writes()).toEqual([]);
  });

  it.each(['abc', '0', '-1', '1.5', '2147483648'])('returns 400 INVALID_ID for id %j', async (id) => {
    const { app, db } = setup([STORED]);
    const res = await request(app).put(`/api/experiences/${id}`).send(required);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
    expect(db.queries).toEqual([]);
  });

  it('returns 400 with details for an invalid body', async () => {
    const { app, db } = setup([STORED]);
    const res = await request(app)
      .put('/api/experiences/3')
      .send({ ...required, employment_type: 'Gig', end_date: '2024-13-01' });
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(['employment_type', 'end_date']);
    expect(db.queries).toEqual([]);
  });
});

describe('DELETE /api/experiences/:id', () => {
  it('deletes the record, returns { id } and excludes it from later lists', async () => {
    const { app } = setup([STORED, { ...STORED, id: 4 }]);
    const res = await request(app).delete('/api/experiences/3');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 3 } });
    const list = await request(app).get('/api/experiences');
    expect(list.body.data.map((e) => e.id)).toEqual([4]);
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = setup();
    const res = await request(app).delete('/api/experiences/3');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 INVALID_ID for a non-numeric id', async () => {
    const { app } = setup();
    expect((await request(app).delete('/api/experiences/x')).body.error.code).toBe('INVALID_ID');
  });
});

describe('admin protection', () => {
  it('returns 401 for every write without a token when the real adminOnly is used', async () => {
    const db = fakeDb([STORED]);
    const app = express();
    app.use(jsonBody);
    app.use('/api', createExperienceRouter({ db, config }));
    app.use(createErrorHandler({ logger: silent }));
    for (const res of [
      await request(app).post('/api/experiences').send(valid()),
      await request(app).put('/api/experiences/abc').send({}),
      await request(app).delete('/api/experiences/3'),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
    expect(db.queries).toEqual([]);
    expect((await request(app).get('/api/experiences')).status).toBe(200);
  });
});

describe('experienceService', () => {
  it('checks a submitted end date against the stored start date when start_date is omitted', async () => {
    const db = fakeDb([STORED]);
    const service = createExperienceService({ db });
    await expect(service.update(3, { end_date: '2019-12-31' })).rejects.toBeInstanceOf(ValidationError);
    expect(db.writes()).toEqual([]);
    await expect(service.update(3, { end_date: '2020-01-01' })).resolves.toMatchObject({ end_date: '2020-01-01' });
  });

  it('maps the end-date CHECK violation to the same 400 before_start error', async () => {
    const service = createExperienceService({ db: fakeDb() });
    const err = await service
      .create({ ...valid(), job_title: 'x', start_date: '2023-03-01', end_date: '2023-01-01' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details).toEqual([expect.objectContaining({ field: 'end_date', reason: 'before_start' })]);
  });

  it('passes other Database errors through unchanged', async () => {
    const boom = Object.assign(new Error('connection reset'), { code: '08006' });
    const db = { query: async () => Promise.reject(boom), withTransaction: async () => Promise.reject(boom) };
    const service = createExperienceService({ db });
    await expect(service.list()).rejects.toBe(boom);
    await expect(service.update(1, { job_title: 'x' })).rejects.toBe(boom);
  });

  it('builds no UPDATE when no field is submitted', () => {
    expect(buildUpdate(1, {})).toBeNull();
    expect(buildUpdate(1, { unknown: 'x', description: undefined })).toBeNull();
  });
});
