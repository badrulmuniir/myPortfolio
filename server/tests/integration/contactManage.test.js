// Contact message management against the PostgreSQL test database
// (Requirements 19.1, 19.2, 19.3, 19.4, 19.8).
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createContactRouter } from '../../src/routes/contact.routes.js';
import { createContactLimiter } from '../../src/utils/rateLimiter.js';
import { createContactMessage } from '../helpers/factories.js';
import { closeTestDb, getTestDb, resetDb } from '../helpers/testDb.js';

const config = loadAppConfig({
  JWT_SECRET: 'integration-test-secret-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  // Only used by the config loader; the router uses the injected test db.
  DATABASE_URL: 'postgres://unused@localhost:5432/unused',
});
const silent = { info() {}, warn() {}, error() {} };
const db = getTestDb();

const stubAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];

const app = express();
app.use(jsonBody);
app.use(
  '/api',
  createContactRouter({
    db,
    config,
    logger: silent,
    requireAdmin: stubAdmin,
    contactLimiter: createContactLimiter({ sweepIntervalMs: 0 }),
  }),
);
app.use(createErrorHandler({ logger: silent }));

beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

const minute = (n) => new Date(Date.UTC(2024, 0, 1, 0, n)).toISOString();

/** Inserts `count` messages; message i (1-based) is created at minute i, so higher ids are newer. */
async function seedMessages(count, isRead = () => false) {
  const rows = [];
  for (let i = 1; i <= count; i += 1) {
    rows.push(await createContactMessage(db, { created_at: minute(i), is_read: isRead(i) }));
  }
  return rows;
}

const ids = (res) => res.body.data.map((m) => m.id);
const range = (from, to) => Array.from({ length: from - to + 1 }, (_, k) => from - k);

describe('GET /api/contact against the test database', () => {
  it('paginates 25 messages newest first with the total in meta', async () => {
    await seedMessages(25);

    const first = await request(app).get('/api/contact');
    expect(first.status).toBe(200);
    expect(ids(first)).toEqual(range(25, 6));
    expect(first.body.meta).toEqual({ total: 25, page: 1, limit: 20 });

    const page2 = await request(app).get('/api/contact?page=2&limit=10');
    expect(ids(page2)).toEqual(range(15, 6));
    expect(page2.body.meta).toEqual({ total: 25, page: 2, limit: 10 });

    const page3 = await request(app).get('/api/contact?page=3&limit=10');
    expect(ids(page3)).toEqual(range(5, 1));

    const page4 = await request(app).get('/api/contact?page=4&limit=10');
    expect(page4.status).toBe(200);
    expect(page4.body).toEqual({ success: true, data: [], meta: { total: 25, page: 4, limit: 10 } });

    const huge = await request(app).get(`/api/contact?page=${Number.MAX_SAFE_INTEGER}&limit=100`);
    expect(huge.status).toBe(200);
    expect(huge.body.data).toEqual([]);
    expect(huge.body.meta.total).toBe(25);
  });

  it('returns the ContactMessage shape with an ISO created_at', async () => {
    const [row] = await seedMessages(1);
    const res = await request(app).get('/api/contact');
    expect(res.body.data).toEqual([
      {
        id: row.id,
        name: row.name,
        email: row.email,
        subject: row.subject,
        message: row.message,
        is_read: false,
        created_at: minute(1),
      },
    ]);
  });

  it('filters by is_read and counts the filtered set', async () => {
    await seedMessages(7, (i) => i % 3 === 0); // 3 and 6 read

    const read = await request(app).get('/api/contact?is_read=true');
    expect(ids(read)).toEqual([6, 3]);
    expect(read.body.meta.total).toBe(2);

    const unread = await request(app).get('/api/contact?is_read=false&limit=2&page=2');
    expect(ids(unread)).toEqual([4, 2]);
    expect(unread.body.meta).toEqual({ total: 5, page: 2, limit: 2 });

    const none = await request(app).get('/api/contact?is_read=true&page=2&limit=2');
    expect(none.body).toEqual({ success: true, data: [], meta: { total: 2, page: 2, limit: 2 } });
  });

  it('orders messages with the same created_at by id descending', async () => {
    for (let i = 0; i < 4; i += 1) await createContactMessage(db, { created_at: minute(10) });
    await createContactMessage(db, { created_at: minute(5) });
    const res = await request(app).get('/api/contact');
    expect(ids(res)).toEqual([4, 3, 2, 1, 5]);
  });
});

describe('single-message operations against the test database', () => {
  it('GET /api/contact/:id leaves is_read unchanged', async () => {
    const [row] = await seedMessages(1);
    const res = await request(app).get(`/api/contact/${row.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: row.id, is_read: false, message: row.message });
    const { rows } = await db.query('SELECT is_read FROM contact_messages WHERE id = $1', [row.id]);
    expect(rows[0].is_read).toBe(false);
    expect((await request(app).get('/api/contact/999')).status).toBe(404);
  });

  it('PATCH /api/contact/:id/read changes only is_read and is idempotent', async () => {
    const [row] = await seedMessages(1);
    const { rows: before } = await db.query('SELECT * FROM contact_messages WHERE id = $1', [row.id]);

    for (let i = 0; i < 2; i += 1) {
      const res = await request(app).patch(`/api/contact/${row.id}/read`).send({ is_read: true });
      expect(res.status).toBe(200);
      expect(res.body.data.is_read).toBe(true);
    }
    const { rows: after } = await db.query('SELECT * FROM contact_messages WHERE id = $1', [row.id]);
    expect(after[0]).toEqual({ ...before[0], is_read: true });

    const back = await request(app).patch(`/api/contact/${row.id}/read`).send({ is_read: false });
    expect(back.body.data.is_read).toBe(false);

    const bad = await request(app).patch(`/api/contact/${row.id}/read`).send({ is_read: 'true' });
    expect(bad.status).toBe(400);
    const { rows: unchanged } = await db.query('SELECT is_read FROM contact_messages WHERE id = $1', [row.id]);
    expect(unchanged[0].is_read).toBe(false);
  });

  it('DELETE /api/contact/:id removes the message from get, the list and the total', async () => {
    const rows = await seedMessages(3, (i) => i === 2);
    const target = rows[1];
    const res = await request(app).delete(`/api/contact/${target.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: target.id } });

    expect((await request(app).get(`/api/contact/${target.id}`)).status).toBe(404);
    const list = await request(app).get('/api/contact');
    expect(ids(list)).toEqual([3, 1]);
    expect(list.body.meta.total).toBe(2);
    expect((await request(app).get('/api/contact?is_read=true')).body.meta.total).toBe(0);
    expect((await request(app).delete(`/api/contact/${target.id}`)).status).toBe(404);
  });
});
