// Profile endpoints against the PostgreSQL test database
// (Requirements 10.1, 10.2, 10.5, 10.9, 10.10, 10.12).
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createProfileRouter } from '../../src/routes/profile.routes.js';
import { PROFILE_FIELDS } from '../../src/validators/profile.schemas.js';
import { createProfile } from '../helpers/factories.js';
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
    req.auth = { id: 1, email: 'a@example.com', role: 'admin' };
    next();
  },
];

const db = getTestDb();
const app = express();
app.use(jsonBody);
app.use('/api', createProfileRouter({ db, config, requireAdmin: stubAdmin }));
app.use(createErrorHandler({ logger: silent }));

beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

const validBody = { name: 'Grace Hopper', professional_title: 'Admiral', email: 'grace@example.com' };

describe('GET /api/profile', () => {
  it('returns the ten fields with empty strings for unset optional fields', async () => {
    await createProfile(db, { name: 'Test Developer', professional_title: 'Engineer', email: 'owner@example.com' });
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      name: 'Test Developer',
      professional_title: 'Engineer',
      personal_introduction: '',
      biography: '',
      career_interests: '',
      professional_goals: '',
      profile_image_url: '',
      email: 'owner@example.com',
      github_url: '',
      linkedin_url: '',
    });
    expect(Object.keys(res.body.data)).toEqual([...PROFILE_FIELDS]);
  });

  it('returns 404 when the Profile row is missing', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('PUT /api/profile', () => {
  it('round-trips submitted trimmed values and keeps omitted optional fields', async () => {
    await createProfile(db, { biography: 'Old bio', github_url: 'https://github.com/old', career_interests: 'Compilers' });
    const put = await request(app)
      .put('/api/profile')
      .send({ ...validBody, name: '  Grace Hopper ', biography: ' New bio ', github_url: '' });
    expect(put.status).toBe(200);

    const get = await request(app).get('/api/profile');
    expect(get.body.data).toEqual(put.body.data);
    expect(get.body.data).toMatchObject({
      name: 'Grace Hopper',
      biography: 'New bio',
      github_url: '',
      career_interests: 'Compilers',
    });
  });

  it('advances updated_at and keeps created_at', async () => {
    const before = await createProfile(db);
    await request(app).put('/api/profile').send(validBody).expect(200);
    const { rows } = await db.query('SELECT created_at, updated_at FROM profile WHERE id = 1');
    expect(rows[0].created_at).toEqual(before.created_at);
    expect(rows[0].updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
  });

  it('returns 400 and leaves the stored Profile unchanged for an invalid body', async () => {
    await createProfile(db);
    const before = await snapshot(db, ['profile']);
    const res = await request(app)
      .put('/api/profile')
      .send({ ...validBody, email: 'bad', unknown_key: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['email', 'unknown_key']);
    expect(await snapshot(db, ['profile'])).toEqual(before);
  });

  it('returns 404 and creates no row when the Profile row is missing', async () => {
    const res = await request(app).put('/api/profile').send(validBody);
    expect(res.status).toBe(404);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM profile');
    expect(rows[0].n).toBe(0);
  });
});
