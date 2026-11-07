// POST /api/contact with a fake db and a fake clock
// (Requirements 8.2, 8.3, 8.4, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6).
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createContactRouter } from '../../src/routes/contact.routes.js';
import { SQL } from '../../src/services/contactService.js';
import { createContactLimiter } from '../../src/utils/rateLimiter.js';

const config = loadAppConfig({
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});
const silent = { info() {}, warn() {}, error() {} };

/** Fake db recording every statement. `fail` makes the INSERT reject like a pg error. */
function fakeDb({ fail = false } = {}) {
  const calls = [];
  let nextId = 1;
  return {
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      if (text !== SQL.submit) throw new Error(`unexpected query ${text}`);
      if (fail) throw Object.assign(new Error('relation "contact_messages" violates something'), { code: '23514' });
      return { rows: [{ id: nextId++ }] };
    },
  };
}

function setup({ db = fakeDb() } = {}) {
  const clock = { t: Date.UTC(2024, 0, 1), now() { return this.t; } };
  const contactLimiter = createContactLimiter({ clock, sweepIntervalMs: 0 });
  const app = express();
  app.use(jsonBody);
  // requireAdmin is unused by POST /api/contact; a stub that would fail loudly proves it.
  app.use('/api', createContactRouter({ db, config, clock, contactLimiter, requireAdmin: [(req, res) => res.status(418).end()] }));
  app.use(createErrorHandler({ logger: silent }));
  return { app, db, clock, contactLimiter };
}

const valid = { name: 'Ann Visitor', email: 'ann@example.com', subject: 'Hello', message: 'I would like to talk.' };
const RECEIVED = { success: true, data: { received: true } };
const submit = (app, body) => request(app).post('/api/contact').send(body);
const fields = (res) => res.body.error.details.map((d) => d.field).sort();

describe('POST /api/contact: stored submissions', () => {
  it('returns 201 with exactly { received: true } and inserts the sanitized, trimmed values', async () => {
    const { app, db } = setup();
    const res = await submit(app, {
      name: '  Ann\u0000 Visitor\u0007 ',
      email: '\u007F ann@example.com ',
      subject: '\tHello\u001F',
      message: ' Line one\nLine\u000B two\r\n ',
      website: '',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(RECEIVED);
    expect(db.calls).toEqual([
      { text: SQL.submit, params: ['Ann Visitor', 'ann@example.com', 'Hello', 'Line one\nLine two'] },
    ]);
  });

  it('ignores unknown fields such as id, is_read and created_at', async () => {
    const { app, db } = setup();
    const res = await submit(app, { ...valid, id: 99, is_read: true, created_at: '2000-01-01T00:00:00Z', extra: 'x' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(RECEIVED);
    expect(db.calls).toEqual([{ text: SQL.submit, params: [valid.name, valid.email, valid.subject, valid.message] }]);
  });

  it('inserts only the four fields and lets the Database set id, is_read and created_at', () => {
    expect(SQL.submit).toMatch(/INSERT INTO contact_messages \(name, email, subject, message\)/);
    expect(SQL.submit).not.toMatch(/is_read|created_at/);
  });

  it('is public: an Authorization header is ignored', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/contact').set('Authorization', 'Bearer garbage').send(valid);
    expect(res.status).toBe(201);
  });
});

describe('POST /api/contact: honeypot', () => {
  it.each([' ', 'https://spam.example', 0, false, { a: 1 }])(
    'a filled honeypot %j returns the same 201 body and stores nothing, even with invalid fields',
    async (website) => {
      const { app, db } = setup();
      const res = await submit(app, { name: '', email: 'bad', message: 'short', website });
      expect(res.status).toBe(201);
      expect(res.body).toEqual(RECEIVED);
      expect(db.calls).toEqual([]);
    },
  );

  it('an empty honeypot is validated normally', async () => {
    const { app, db } = setup();
    const res = await submit(app, { ...valid, email: 'bad', website: '' });
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(['email']);
    expect(db.calls).toEqual([]);
  });
});

describe('POST /api/contact: validation', () => {
  it.each([
    ['a 101-character name', { name: 'x'.repeat(101) }, ['name']],
    ['an invalid email', { email: 'not-an-email' }, ['email']],
    ['an empty subject', { subject: '   ' }, ['subject']],
    ['a 9-character message', { message: '123456789' }, ['message']],
    ['a message of 9 characters plus control characters', { message: '123456789\u0000\u0001' }, ['message']],
    ['a non-string name', { name: 42 }, ['name']],
    ['several invalid fields', { name: '', email: 5, subject: 'x'.repeat(151) }, ['email', 'name', 'subject']],
  ])('returns 400 for %s and stores nothing', async (_label, change, expected) => {
    const { app, db } = setup();
    const res = await submit(app, { ...valid, ...change });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(fields(res)).toEqual(expected);
    expect(db.calls).toEqual([]);
  });

  it('reports every missing field', async () => {
    const { app, db } = setup();
    const res = await submit(app, {});
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(['email', 'message', 'name', 'subject']);
    expect(db.calls).toEqual([]);
  });

  it('returns 400 for an array body', async () => {
    const { app, db } = setup();
    const res = await submit(app, [valid]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(fields(res)).toEqual(['body']);
    expect(db.calls).toEqual([]);
  });

  it('returns 400 when no JSON body is sent', async () => {
    const { app, db } = setup();
    const res = await request(app).post('/api/contact');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(fields(res)).toEqual(['body']);
    expect(db.calls).toEqual([]);
  });
});

describe('POST /api/contact: rate limiting', () => {
  it('rejects the 6th counted submission with 429 and Retry-After, without storing it', async () => {
    const { app, db, clock } = setup();
    for (let i = 0; i < 5; i += 1) expect((await submit(app, valid)).status).toBe(201);
    clock.t += 1_000;
    const res = await submit(app, valid);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'TOO_MANY_CONTACT_SUBMISSIONS', message: 'Too many messages sent. Please try again later.' },
    });
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBe(3599);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect(db.calls).toHaveLength(5);
  });

  it('blocks before the honeypot check and before validation', async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i += 1) await submit(app, valid);
    expect((await submit(app, { website: 'x' })).status).toBe(429);
    expect((await submit(app, {})).status).toBe(429);
  });

  it('does not count 400 responses', async () => {
    const { app } = setup();
    for (let i = 0; i < 10; i += 1) expect((await submit(app, {})).status).toBe(400);
    for (let i = 0; i < 5; i += 1) expect((await submit(app, valid)).status).toBe(201);
    expect((await submit(app, valid)).status).toBe(429);
  });

  it('counts honeypot discards', async () => {
    const { app, db } = setup();
    for (let i = 0; i < 5; i += 1) expect((await submit(app, { ...valid, website: 'bot' })).status).toBe(201);
    expect((await submit(app, valid)).status).toBe(429);
    expect(db.calls).toEqual([]);
  });

  it('does not count 429 responses and unblocks when the 60-minute window ends', async () => {
    const { app, clock } = setup();
    const start = clock.t;
    for (let i = 0; i < 5; i += 1) await submit(app, valid);
    for (let i = 0; i < 3; i += 1) expect((await submit(app, valid)).status).toBe(429);
    clock.t = start + 60 * 60 * 1000 - 1;
    expect((await submit(app, valid)).status).toBe(429);
    clock.t = start + 60 * 60 * 1000;
    for (let i = 0; i < 5; i += 1) expect((await submit(app, valid)).status).toBe(201);
    expect((await submit(app, valid)).status).toBe(429);
  });
});

describe('POST /api/contact: Database failure', () => {
  it('returns a generic 500 without the received flag or Database details', async () => {
    const { app, db } = setup({ db: fakeDb({ fail: true }) });
    const res = await submit(app, valid);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/received|contact_messages/);
    expect(db.calls).toHaveLength(1);
  });

  it('does not count a 500 response', async () => {
    const { app, contactLimiter } = setup({ db: fakeDb({ fail: true }) });
    for (let i = 0; i < 6; i += 1) expect((await submit(app, valid)).status).toBe(500);
    expect(contactLimiter.size).toBe(0);
  });
});
