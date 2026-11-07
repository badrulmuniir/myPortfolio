// Education endpoints against the PostgreSQL test database (Requirements 17.1, 17.2, 17.5, 17.7).
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createEducationRouter } from '../../src/routes/education.routes.js';
import { createEducation } from '../helpers/factories.js';
import { closeTestDb, getTestDb, resetDb, snapshot } from '../helpers/testDb.js';

const config = loadAppConfig({
  JWT_SECRET: 'integration-test-secret-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  // Only used by the config loader; the router uses the injected test db.
  DATABASE_URL: 'postgres://unused@localhost:5432/unused',
});
const silent = { info() {}, warn() {}, error() {} };
const clock = { now: () => Date.UTC(2025, 0, 1) };
const db = getTestDb();

const stubAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];

const app = express();
app.use(jsonBody);
app.use('/api', createEducationRouter({ db, config, clock, logger: silent, requireAdmin: stubAdmin }));
app.use(createErrorHandler({ logger: silent }));

beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

describe('education CRUD against the test database', () => {
  it('creates, reads, replaces and deletes a record', async () => {
    const created = await request(app).post('/api/education').send({
      institution: '  Tech University ',
      qualification: ' BSc Software Engineering ',
      field_of_study: ' Software ',
      start_year: 2019,
      end_year: 2023,
      description: '  Line one\nLine two  ',
    });
    expect(created.status).toBe(201);
    const record = {
      id: created.body.data.id,
      institution: 'Tech University',
      qualification: 'BSc Software Engineering',
      field_of_study: 'Software',
      start_year: 2019,
      end_year: 2023,
      description: 'Line one\nLine two',
    };
    expect(created.body.data).toEqual(record);
    expect((await request(app).get('/api/education')).body.data).toEqual([record]);

    const updated = await request(app)
      .put(`/api/education/${record.id}`)
      .send({ institution: 'Other College', qualification: 'Diploma', start_year: 2024 });
    expect(updated.status).toBe(200);
    const replaced = {
      id: record.id,
      institution: 'Other College',
      qualification: 'Diploma',
      field_of_study: '',
      start_year: 2024,
      end_year: null,
      description: '',
    };
    expect(updated.body.data).toEqual(replaced);
    expect((await request(app).get('/api/education')).body.data).toEqual([replaced]);

    const removed = await request(app).delete(`/api/education/${record.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ id: record.id });
    expect((await request(app).get('/api/education')).body.data).toEqual([]);
  });

  it('orders by start year desc, null end year first, then end year desc, then id asc', async () => {
    const a = await createEducation(db, { start_year: 2018, end_year: 2022 });
    const b = await createEducation(db, { start_year: 2020, end_year: 2021 });
    const c = await createEducation(db, { start_year: 2020, end_year: null });
    const d = await createEducation(db, { start_year: 2020, end_year: 2024 });
    const e = await createEducation(db, { start_year: 2020, end_year: 2024 });

    const res = await request(app).get('/api/education');
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.id)).toEqual([c.id, d.id, e.id, b.id, a.id]);
    expect(res.body.data[0].end_year).toBeNull();
  });

  it('returns 404 for PUT and DELETE on an unknown id and changes nothing', async () => {
    const existing = await createEducation(db);
    const before = await snapshot(db, ['education']);
    const id = existing.id + 100;

    const put = await request(app)
      .put(`/api/education/${id}`)
      .send({ institution: 'X', qualification: 'Y', start_year: 2020 });
    const del = await request(app).delete(`/api/education/${id}`);

    expect(put.status).toBe(404);
    expect(del.status).toBe(404);
    expect(await snapshot(db, ['education'])).toEqual(before);
  });

  it('rejects an end year before the start year and leaves the table unchanged', async () => {
    await createEducation(db);
    const before = await snapshot(db, ['education']);
    const res = await request(app)
      .post('/api/education')
      .send({ institution: 'X', qualification: 'Y', start_year: 2020, end_year: 2019 });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toEqual(['end_year']);
    expect(await snapshot(db, ['education'])).toEqual(before);
  });
});
