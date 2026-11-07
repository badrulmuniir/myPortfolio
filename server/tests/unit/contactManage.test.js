// Contact message management with a fake db (Requirements 19.1, 19.2, 19.3, 19.4, 19.8, 19.10, 19.11).
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createContactRouter } from '../../src/routes/contact.routes.js';
import { offsetFor, SQL } from '../../src/services/contactService.js';
import { createContactLimiter } from '../../src/utils/rateLimiter.js';

const config = loadAppConfig({
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});
const silent = { info() {}, warn() {}, error() {} };

const COLUMNS = ['id', 'name', 'email', 'subject', 'message', 'is_read', 'created_at'];
const pick = (r) => Object.fromEntries(COLUMNS.map((c) => [c, r[c]]));

/** In-memory contact_messages table answering exactly the service's statements. */
function fakeDb(initial = []) {
  const rows = initial.map((r) => ({ ...r }));
  const calls = [];
  return {
    rows,
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      if (text === SQL.list) {
        const [isRead, limit, offset] = params;
        const filtered = rows
          .filter((r) => isRead === null || r.is_read === isRead)
          .sort((a, b) => b.created_at - a.created_at || b.id - a.id);
        const total = filtered.length;
        const start = Number(offset);
        const page = filtered.slice(start, start + limit);
        if (page.length === 0) return { rows: [{ total, ...Object.fromEntries(COLUMNS.map((c) => [c, null])) }] };
        return { rows: page.map((r) => ({ total, ...pick(r) })) };
      }
      if (text === SQL.get) {
        const row = rows.find((r) => r.id === params[0]);
        return { rows: row ? [pick(row)] : [] };
      }
      if (text === SQL.setRead) {
        const row = rows.find((r) => r.id === params[0]);
        if (!row) return { rows: [] };
        row.is_read = params[1];
        return { rows: [pick(row)] };
      }
      if (text === SQL.remove) {
        const i = rows.findIndex((r) => r.id === params[0]);
        if (i === -1) return { rows: [] };
        const [removed] = rows.splice(i, 1);
        return { rows: [{ id: removed.id }] };
      }
      if (text === SQL.submit) return { rows: [{ id: 999 }] };
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
  const deps = { db, config, logger: silent, contactLimiter: createContactLimiter({ sweepIntervalMs: 0 }) };
  if (requireAdmin) deps.requireAdmin = requireAdmin;
  app.use('/api', createContactRouter(deps));
  app.use(createErrorHandler({ logger: silent }));
  return { app, db };
}

const at = (minute) => new Date(Date.UTC(2024, 0, 1, 0, minute));
const message = (id, overrides = {}) => ({
  id,
  name: `Sender ${id}`,
  email: `sender${id}@example.com`,
  subject: `Subject ${id}`,
  message: `Message body ${id}`,
  is_read: false,
  created_at: at(id),
  ...overrides,
});
const json = (r) => ({ ...r, created_at: r.created_at.toISOString() });
const fieldsOf = (res) => res.body.error.details.map((d) => d.field).sort();

describe('GET /api/contact', () => {
  it('orders by created_at DESC, id DESC and binds LIMIT and OFFSET as parameters', () => {
    expect(SQL.list).toMatch(/ORDER BY created_at DESC, id DESC\s+LIMIT \$2 OFFSET \$3::bigint/);
    expect(SQL.list).toMatch(/ORDER BY m\.created_at DESC, m\.id DESC$/);
    expect(SQL.list).toMatch(/count\(\*\)::int AS total FROM contact_messages WHERE \(\$1::boolean IS NULL OR is_read = \$1\)/);
  });

  it('uses page 1 and limit 20 by default and returns meta', async () => {
    const { app, db } = setup({ db: fakeDb([message(1), message(2, { is_read: true })]) });
    const res = await request(app).get('/api/contact');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [json(message(2, { is_read: true })), json(message(1))],
      meta: { total: 2, page: 1, limit: 20 },
    });
    expect(db.calls).toEqual([{ text: SQL.list, params: [null, 20, '0'] }]);
  });

  it('applies page and limit and orders ties by id descending', async () => {
    const same = at(5);
    const db = fakeDb([1, 2, 3, 4, 5].map((id) => message(id, { created_at: same })));
    const { app } = setup({ db });
    const res = await request(app).get('/api/contact?page=2&limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data.map((m) => m.id)).toEqual([3, 2]);
    expect(res.body.meta).toEqual({ total: 5, page: 2, limit: 2 });
    expect(db.calls[0].params).toEqual([null, 2, '2']);
  });

  it('returns [] with the correct total for a page beyond the last page', async () => {
    const { app } = setup({ db: fakeDb([message(1), message(2)]) });
    const res = await request(app).get('/api/contact?page=3&limit=1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [], meta: { total: 2, page: 3, limit: 1 } });
  });

  it('returns [] with total 0 when there are no messages', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/contact');
    expect(res.body).toEqual({ success: true, data: [], meta: { total: 0, page: 1, limit: 20 } });
  });

  it.each([
    ['true', true, [2]],
    ['false', false, [3, 1]],
  ])('filters by is_read=%s in both data and total', async (raw, value, ids) => {
    const db = fakeDb([message(1), message(2, { is_read: true }), message(3)]);
    const { app } = setup({ db });
    const res = await request(app).get(`/api/contact?is_read=${raw}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((m) => m.id)).toEqual(ids);
    expect(res.body.meta.total).toBe(ids.length);
    expect(db.calls[0].params[0]).toBe(value);
  });

  it('computes an exact OFFSET for the largest accepted page', async () => {
    expect(offsetFor(1, 20)).toBe('0');
    expect(offsetFor(3, 10)).toBe('20');
    expect(offsetFor(Number.MAX_SAFE_INTEGER, 100)).toBe(((2n ** 53n - 2n) * 100n).toString());
    const { app, db } = setup({ db: fakeDb([message(1)]) });
    const res = await request(app).get(`/api/contact?page=${Number.MAX_SAFE_INTEGER}&limit=100`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [], meta: { total: 1, page: Number.MAX_SAFE_INTEGER, limit: 100 } });
    expect(db.calls[0].params[2]).toBe('900719925474099000');
  });

  it.each([
    ['page=abc', ['page']],
    ['page=0', ['page']],
    ['page=-1', ['page']],
    ['page=1.5', ['page']],
    ['limit=0', ['limit']],
    ['limit=101', ['limit']],
    ['is_read=yes', ['is_read']],
    ['is_read=TRUE', ['is_read']],
    ['page=a&limit=0&is_read=1', ['is_read', 'limit', 'page']],
  ])('returns 400 VALIDATION_ERROR for ?%s naming each invalid parameter, with no query', async (qs, fields) => {
    const { app, db } = setup({ db: fakeDb([message(1)]) });
    const res = await request(app).get(`/api/contact?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(fieldsOf(res)).toEqual(fields);
    expect(res.body.data).toBeUndefined();
    expect(db.calls).toEqual([]);
  });
});

describe('GET /api/contact/:id', () => {
  it('returns the message and issues no UPDATE', async () => {
    const db = fakeDb([message(1)]);
    const { app } = setup({ db });
    const res = await request(app).get('/api/contact/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: json(message(1)) });
    expect(db.calls).toEqual([{ text: SQL.get, params: [1] }]);
    expect(SQL.get).not.toMatch(/UPDATE/i);
    expect(db.rows[0].is_read).toBe(false);
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = setup({ db: fakeDb([message(1)]) });
    const res = await request(app).get('/api/contact/2');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Message not found' } });
  });
});

describe('PATCH /api/contact/:id/read', () => {
  it('sets is_read and returns the updated message, leaving other fields unchanged', async () => {
    const db = fakeDb([message(1)]);
    const { app } = setup({ db });
    const res = await request(app).patch('/api/contact/1/read').send({ is_read: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: json(message(1, { is_read: true })) });
    expect(db.rows).toEqual([message(1, { is_read: true })]);
  });

  it('succeeds when the value equals the current read status', async () => {
    const db = fakeDb([message(1, { is_read: true })]);
    const { app } = setup({ db });
    for (let i = 0; i < 2; i += 1) {
      const res = await request(app).patch('/api/contact/1/read').send({ is_read: true });
      expect(res.status).toBe(200);
      expect(res.body.data.is_read).toBe(true);
    }
  });

  it.each([
    ['a missing is_read', {}],
    ['the string "true"', { is_read: 'true' }],
    ['the string "false"', { is_read: 'false' }],
    ['a number', { is_read: 1 }],
    ['null', { is_read: null }],
  ])('returns 400 on is_read for %s and changes nothing', async (_label, body) => {
    const db = fakeDb([message(1)]);
    const { app } = setup({ db });
    const res = await request(app).patch('/api/contact/1/read').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(fieldsOf(res)).toEqual(['is_read']);
    expect(db.calls).toEqual([]);
  });

  it('rejects unknown body fields', async () => {
    const { app } = setup({ db: fakeDb([message(1)]) });
    const res = await request(app).patch('/api/contact/1/read').send({ is_read: true, subject: 'x' });
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toEqual(['subject']);
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = setup({ db: fakeDb([message(1)]) });
    const res = await request(app).patch('/api/contact/2/read').send({ is_read: true });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Message not found');
  });
});

describe('DELETE /api/contact/:id', () => {
  it('deletes the message, returns { id } and excludes it from the list and total', async () => {
    const db = fakeDb([message(1), message(2)]);
    const { app } = setup({ db });
    const res = await request(app).delete('/api/contact/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 1 } });
    expect((await request(app).get('/api/contact/1')).status).toBe(404);
    const list = await request(app).get('/api/contact');
    expect(list.body.data.map((m) => m.id)).toEqual([2]);
    expect(list.body.meta.total).toBe(1);
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = setup();
    const res = await request(app).delete('/api/contact/7');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('id parameter', () => {
  it.each([
    ['get', '/api/contact/abc'],
    ['get', '/api/contact/0'],
    ['patch', '/api/contact/1.5/read'],
    ['patch', '/api/contact/2147483648/read'],
    ['delete', '/api/contact/-1'],
  ])('%s %s returns 400 INVALID_ID before validating the body', async (method, path) => {
    const db = fakeDb([message(1)]);
    const { app } = setup({ db });
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
    expect(db.calls).toEqual([]);
  });
});

describe('admin protection with the real adminOnly', () => {
  it.each([
    ['get', '/api/contact?page=abc'],
    ['get', '/api/contact/1'],
    ['patch', '/api/contact/abc/read'],
    ['delete', '/api/contact/1'],
  ])('%s %s without a token returns 401 and runs no query', async (method, path) => {
    const db = fakeDb([message(1)]);
    const { app } = setup({ db, requireAdmin: null });
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(db.calls).toEqual([]);
  });

  it('POST /api/contact stays public', async () => {
    const db = fakeDb();
    const { app } = setup({ db, requireAdmin: null });
    const res = await request(app)
      .post('/api/contact')
      .send({ name: 'Ann', email: 'ann@example.com', subject: 'Hi', message: 'Hello there, friend.' });
    expect(res.status).toBe(201);
    expect(db.calls.map((c) => c.text)).toEqual([SQL.submit]);
  });
});
