// Experience endpoints against the PostgreSQL test database (Requirements 16.1, 16.2, 16.5, 16.7,
// 16.9, 16.10).
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createExperienceRouter } from '../../src/routes/experience.routes.js';
import { createExperienceService } from '../../src/services/experienceService.js';
import { ValidationError } from '../../src/utils/errors.js';
import { createExperience } from '../helpers/factories.js';
import { closeTestDb, getTestDb, resetDb, snapshot } from '../helpers/testDb.js';

const config = loadAppConfig({
  JWT_SECRET: 'integration-test-secret-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  // Only used by the config loader; the router uses the injected test db.
  DATABASE_URL: 'postgres://unused@localhost:5432/unused',
});
const silent = { info() {}, warn() {}, error() {} };
const stubAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];

const db = getTestDb();
const app = express();
app.use(jsonBody);
app.use('/api', createExperienceRouter({ db, config, requireAdmin: stubAdmin, logger: silent }));
app.use(createErrorHandler({ logger: silent }));

beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

const payload = (overrides = {}) => ({
  job_title: ' Backend Developer ',
  company_name: 'Initech',
  employment_type: 'Full-time',
  start_date: '2021-02-01',
  end_date: '2023-07-31',
  description: 'Built APIs.',
  responsibilities: ['  Zeta task ', 'Alpha task', 'Mid task'],
  ...overrides,
});

describe('experience CRUD against the test database', () => {
  it('creates, reads, updates and deletes a record with responsibilities in order', async () => {
    const created = await request(app).post('/api/experiences').send(payload());
    expect(created.status).toBe(201);
    const { id } = created.body.data;
    expect(created.body.data).toEqual({
      id,
      job_title: 'Backend Developer',
      company_name: 'Initech',
      employment_type: 'Full-time',
      start_date: '2021-02-01',
      end_date: '2023-07-31',
      description: 'Built APIs.',
      responsibilities: ['Zeta task', 'Alpha task', 'Mid task'],
    });

    let list = await request(app).get('/api/experiences');
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([created.body.data]);

    const updated = await request(app)
      .put(`/api/experiences/${id}`)
      .send(payload({ job_title: 'Lead', end_date: null, responsibilities: ['Only one'] }));
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ id, job_title: 'Lead', end_date: null, responsibilities: ['Only one'] });

    list = await request(app).get('/api/experiences');
    expect(list.body.data).toEqual([updated.body.data]);

    const removed = await request(app).delete(`/api/experiences/${id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ id });
    expect((await request(app).get('/api/experiences')).body.data).toEqual([]);
    expect((await request(app).delete(`/api/experiences/${id}`)).status).toBe(404);
    expect((await request(app).put(`/api/experiences/${id}`).send(payload())).status).toBe(404);
  });

  it('keeps omitted optional fields on a partial update', async () => {
    const row = await createExperience(db, {
      start_date: '2020-01-01',
      end_date: '2021-01-01',
      description: 'Kept description',
      responsibilities: ['kept a', 'kept b'],
    });
    const res = await request(app).put(`/api/experiences/${row.id}`).send({
      job_title: 'Renamed',
      company_name: row.company_name,
      employment_type: 'Part-time',
      start_date: '2020-01-01',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: row.id,
      job_title: 'Renamed',
      company_name: row.company_name,
      employment_type: 'Part-time',
      start_date: '2020-01-01',
      end_date: '2021-01-01',
      description: 'Kept description',
      responsibilities: ['kept a', 'kept b'],
    });
  });

  it('rejects a new start date after the stored end date and leaves the Database unchanged', async () => {
    const row = await createExperience(db, { start_date: '2020-01-01', end_date: '2021-01-01' });
    const before = await snapshot(db);
    const res = await request(app).put(`/api/experiences/${row.id}`).send({
      job_title: row.job_title,
      company_name: row.company_name,
      employment_type: row.employment_type,
      start_date: '2021-06-01',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'end_date', reason: 'before_start' })]);
    expect(await snapshot(db)).toEqual(before);
  });

  it('checks a submitted end date against the stored start date in the service', async () => {
    const row = await createExperience(db, { start_date: '2020-05-01', end_date: null });
    const service = createExperienceService({ db });
    await expect(service.update(row.id, { end_date: '2020-04-30' })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.update(row.id, { end_date: '2020-05-01' })).resolves.toMatchObject({ end_date: '2020-05-01' });
  });

  it('maps the Database end-date check to 400 before_start on create', async () => {
    const service = createExperienceService({ db });
    const err = await service
      .create({ job_title: 'x', company_name: 'y', employment_type: 'Contract', start_date: '2022-01-02', end_date: '2022-01-01' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details[0]).toMatchObject({ field: 'end_date', reason: 'before_start' });
    expect((await db.query('SELECT count(*)::int AS n FROM experiences')).rows[0].n).toBe(0);
  });

  it('lists records by start date descending, then id descending', async () => {
    const a = await createExperience(db, { start_date: '2019-01-01' });
    const b = await createExperience(db, { start_date: '2022-06-01' });
    const c = await createExperience(db, { start_date: '2022-06-01' });
    const d = await createExperience(db, { start_date: '2020-03-15' });
    const res = await request(app).get('/api/experiences');
    expect(res.body.data.map((e) => e.id)).toEqual([c.id, b.id, d.id, a.id]);
    expect(res.body.data[0].start_date).toBe('2022-06-01');
  });

  it('stores omitted optional fields with their defaults on create', async () => {
    const res = await request(app)
      .post('/api/experiences')
      .send({ job_title: 'Intern', company_name: 'Lab', employment_type: 'Internship', start_date: '2018-06-01' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ end_date: null, description: '', responsibilities: [] });
  });
});
