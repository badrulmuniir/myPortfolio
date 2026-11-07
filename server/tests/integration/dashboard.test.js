// Dashboard stats against the PostgreSQL test database (Requirements 20.1, 20.4).
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createDashboardRouter } from '../../src/routes/dashboard.routes.js';
import {
  createContactMessage,
  createEducation,
  createExperience,
  createProject,
  createSkill,
} from '../helpers/factories.js';
import { closeTestDb, getTestDb, resetDb } from '../helpers/testDb.js';

const config = loadAppConfig({
  JWT_SECRET: 'integration-test-secret-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  // Only used by the config loader; the router uses the injected test db.
  DATABASE_URL: 'postgres://unused@localhost:5432/unused',
});
const db = getTestDb();

// Admin protection is covered by the unit and auth tests; here it is replaced by a stub.
const requireAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];
const app = express();
app.use(jsonBody);
app.use('/api', createDashboardRouter({ db, config, requireAdmin }));
app.use(createErrorHandler({ logger: { info() {}, warn() {}, error() {} } }));

beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

const getStats = async () => {
  const res = await request(app).get('/api/dashboard/stats');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  return res.body.data;
};

describe('GET /api/dashboard/stats against the test database', () => {
  it('returns seven zero counts for an empty database', async () => {
    expect(await getStats()).toEqual({
      projects_total: 0,
      projects_published: 0,
      skills: 0,
      experiences: 0,
      education: 0,
      messages_total: 0,
      messages_unread: 0,
    });
  });

  it('returns counts equal to the database contents', async () => {
    await createProject(db, { is_published: true });
    await createProject(db, { is_published: false });
    for (let i = 0; i < 3; i++) await createSkill(db);
    for (let i = 0; i < 2; i++) await createExperience(db);
    await createEducation(db);
    await createContactMessage(db, { is_read: true });
    await createContactMessage(db);
    await createContactMessage(db);

    const stats = await getStats();
    expect(stats).toEqual({
      projects_total: 2,
      projects_published: 1,
      skills: 3,
      experiences: 2,
      education: 1,
      messages_total: 3,
      messages_unread: 2,
    });
    for (const value of Object.values(stats)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(stats.projects_published).toBeLessThanOrEqual(stats.projects_total);
    expect(stats.messages_unread).toBeLessThanOrEqual(stats.messages_total);
  });
});
