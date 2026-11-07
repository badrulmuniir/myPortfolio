// POST /api/contact against the PostgreSQL test database (Requirements 8.4, 18.1, 18.3, 18.5).
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createContactRouter } from '../../src/routes/contact.routes.js';
import { createContactLimiter } from '../../src/utils/rateLimiter.js';
import { closeTestDb, getTestDb, resetDb, snapshot } from '../helpers/testDb.js';

const config = loadAppConfig({
  JWT_SECRET: 'integration-test-secret-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  // Only used by the config loader; the router uses the injected test db.
  DATABASE_URL: 'postgres://unused@localhost:5432/unused',
});
const db = getTestDb();

/** A fresh app per test, so each test gets its own contact Rate_Limiter. */
function makeApp() {
  const app = express();
  app.use(jsonBody);
  app.use('/api', createContactRouter({ db, config, contactLimiter: createContactLimiter({ sweepIntervalMs: 0 }) }));
  app.use(createErrorHandler({ logger: { info() {}, warn() {}, error() {} } }));
  return app;
}

beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

const valid = { name: 'Ann Visitor', email: 'ann@example.com', subject: 'Hello', message: 'I would like to talk.' };
const RECEIVED = { success: true, data: { received: true } };

describe('POST /api/contact against the test database', () => {
  it('stores exactly one message with sanitized values, is_read false and created_at set', async () => {
    const before = Date.now();
    const res = await request(makeApp())
      .post('/api/contact')
      .send({ ...valid, name: ' Ann\u0000 Visitor ', id: 500, is_read: true, created_at: '2000-01-01T00:00:00Z', website: '' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(RECEIVED);

    const { rows } = await db.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ id: 1, ...valid, is_read: false });
    expect(row.created_at).toBeInstanceOf(Date);
    // Set by the Database at insert time, not taken from the request.
    expect(row.created_at.getTime()).toBeGreaterThan(before - 60_000);
  });

  it('stores nothing for a filled honeypot', async () => {
    const before = await snapshot(db);
    const res = await request(makeApp()).post('/api/contact').send({ ...valid, website: 'spam' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(RECEIVED);
    expect(await snapshot(db)).toEqual(before);
  });

  it('stores nothing for an invalid submission', async () => {
    const before = await snapshot(db);
    const res = await request(makeApp()).post('/api/contact').send({ ...valid, message: 'too short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await snapshot(db)).toEqual(before);
  });
});
