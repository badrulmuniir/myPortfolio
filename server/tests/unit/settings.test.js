// GET and PUT /api/settings with an in-memory fake db (Requirements 11.1, 11.2, 11.3, 11.4, 11.7, 11.8).
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createSettingsRouter } from '../../src/routes/settings.routes.js';
import { SQL, mergeSettings } from '../../src/services/settingsService.js';

const SECRET = 'unit-test-secret-that-is-at-least-32-chars';
const config = loadAppConfig({
  JWT_SECRET: SECRET,
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});
const silent = { info() {}, warn() {}, error() {} };

const DEFAULTS = { site_title: 'My Portfolio', hero_introduction: '', footer_text: '', social_links: [] };

/**
 * Fake db holding settings rows in a Map (key → JSON text, like JSONB storage). Writes inside
 * withTransaction go to a copy that replaces the table only on commit. `failOnKey` makes the
 * upsert of that key throw, to check rollback.
 */
function fakeDb(initial = {}, { failOnKey } = {}) {
  let table = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  const writes = [];

  const runQuery = (rows, text, params) => {
    if (text === SQL.selectAll) {
      const keys = params[0];
      return {
        rows: [...rows]
          .filter(([k]) => keys.includes(k))
          .map(([k, v]) => ({ setting_key: k, setting_value: JSON.parse(v) })),
      };
    }
    if (text === SQL.upsert) {
      const [key, json] = params;
      writes.push(params);
      if (key === failOnKey) throw new Error('simulated write failure');
      expect(typeof json).toBe('string');
      rows.set(key, json);
      return { rows: [] };
    }
    throw new Error(`unexpected query ${text}`);
  };

  return {
    writes,
    stored: () => Object.fromEntries([...table].map(([k, v]) => [k, JSON.parse(v)])),
    query: async (text, params) => {
      if (text !== SQL.selectAll) throw new Error('writes must run in a transaction');
      return runQuery(table, text, params);
    },
    withTransaction: async (work) => {
      const staged = new Map(table);
      const result = await work({ query: async (text, params) => runQuery(staged, text, params) });
      table = staged;
      return result;
    },
  };
}

const stubAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];

function buildApp(db, requireAdmin = stubAdmin) {
  const app = express();
  app.use(jsonBody);
  app.use('/api', createSettingsRouter({ db, config, requireAdmin }));
  app.use(createErrorHandler({ logger: silent }));
  return app;
}

const put = (app, body) => request(app).put('/api/settings').send(body);

describe('GET /api/settings', () => {
  it('returns the defaults when no setting is stored', async () => {
    const res = await request(buildApp(fakeDb())).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: DEFAULTS });
  });

  it('merges stored values over the defaults and returns exactly the four keys', async () => {
    const links = [{ label: 'Blog', url: 'https://blog.example.com' }];
    const db = fakeDb({ hero_introduction: 'Hello there', social_links: links });
    const res = await request(buildApp(db)).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ...DEFAULTS, hero_introduction: 'Hello there', social_links: links });
    expect(Object.keys(res.body.data).sort()).toEqual(['footer_text', 'hero_introduction', 'site_title', 'social_links']);
  });

  it('is public: works without any Authorization header and ignores a bad one', async () => {
    const app = buildApp(fakeDb(), [() => {
      throw new Error('requireAdmin must not run on GET');
    }]);
    expect((await request(app).get('/api/settings')).status).toBe(200);
    expect((await request(app).get('/api/settings').set('Authorization', 'Bearer garbage')).status).toBe(200);
  });
});

describe('mergeSettings', () => {
  it('falls back to defaults for stored values of the wrong type', () => {
    const rows = [
      { setting_key: 'site_title', setting_value: 42 },
      { setting_key: 'footer_text', setting_value: null },
      { setting_key: 'hero_introduction', setting_value: ['x'] },
      { setting_key: 'social_links', setting_value: { label: 'x' } },
    ];
    expect(mergeSettings(rows)).toEqual(DEFAULTS);
  });

  it('keeps only well-formed social links, in order, with only label and url', () => {
    const rows = [
      {
        setting_key: 'social_links',
        setting_value: [
          { label: 'A', url: 'https://a.example.com', extra: true },
          'junk',
          { label: 'B' },
          { label: 'C', url: 'https://c.example.com' },
        ],
      },
    ];
    expect(mergeSettings(rows).social_links).toEqual([
      { label: 'A', url: 'https://a.example.com' },
      { label: 'C', url: 'https://c.example.com' },
    ]);
  });
});

describe('PUT /api/settings', () => {
  it('stores trimmed values for the submitted keys and leaves omitted keys unchanged', async () => {
    const db = fakeDb({ site_title: 'Old Title', footer_text: 'Old footer' });
    const res = await put(buildApp(db), { site_title: '  New Title  ', hero_introduction: '  Hi  ' });
    expect(res.status).toBe(200);
    const expected = { site_title: 'New Title', hero_introduction: 'Hi', footer_text: 'Old footer', social_links: [] };
    expect(res.body).toEqual({ success: true, data: expected });
    expect(db.writes.map(([k]) => k)).toEqual(['site_title', 'hero_introduction']);
    expect((await request(buildApp(db)).get('/api/settings')).body.data).toEqual(expected);
  });

  it('round-trips social_links with the same order, trimmed labels and URLs', async () => {
    const db = fakeDb();
    const app = buildApp(db);
    const submitted = [
      { label: '  Mastodon ', url: 'https://mastodon.example.com/@me' },
      { label: 'Blog', url: ' https://blog.example.com ' },
      { label: 'Dev.to', url: 'http://dev.to/me' },
    ];
    expect((await put(app, { social_links: submitted })).status).toBe(200);
    const res = await request(app).get('/api/settings');
    expect(res.body.data.social_links).toEqual([
      { label: 'Mastodon', url: 'https://mastodon.example.com/@me' },
      { label: 'Blog', url: 'https://blog.example.com' },
      { label: 'Dev.to', url: 'http://dev.to/me' },
    ]);
    // Stored as a JSON array, not a PostgreSQL array literal.
    expect(JSON.parse(db.writes[0][1])).toHaveLength(3);
  });

  it('accepts an empty social_links list and empty optional text', async () => {
    const db = fakeDb({ social_links: [{ label: 'A', url: 'https://a.example.com' }], footer_text: 'x' });
    const res = await put(buildApp(db), { social_links: [], footer_text: '   ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ social_links: [], footer_text: '' });
  });

  it('rejects an unknown key with 400 naming it, and writes nothing, even with valid keys', async () => {
    const db = fakeDb({ site_title: 'Keep' });
    const res = await put(buildApp(db), { site_title: 'Changed', theme: 'dark', other: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field).sort();
    expect(fields).toEqual(['other', 'theme']);
    expect(res.body.error.details.every((d) => d.reason === 'unknown_field')).toBe(true);
    expect(db.writes).toEqual([]);
    expect(db.stored()).toEqual({ site_title: 'Keep' });
  });

  it('rejects a body with none of the allowed keys', async () => {
    const db = fakeDb();
    const res = await put(buildApp(db), {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'body', reason: 'required' })]);
    expect(db.writes).toEqual([]);
  });

  it('rejects a missing JSON body', async () => {
    const db = fakeDb();
    const res = await request(buildApp(db)).put('/api/settings');
    expect(res.status).toBe(400);
    expect(db.writes).toEqual([]);
  });

  it('reports every invalid field with its reason and writes nothing', async () => {
    const db = fakeDb();
    const res = await put(buildApp(db), {
      site_title: 5,
      hero_introduction: 'x'.repeat(501),
      footer_text: ['not a string'],
      social_links: 'nope',
    });
    expect(res.status).toBe(400);
    const byField = Object.fromEntries(res.body.error.details.map((d) => [d.field, d.reason]));
    expect(byField).toEqual({
      site_title: 'type',
      hero_introduction: 'too_long',
      footer_text: 'type',
      social_links: 'type',
    });
    expect(db.writes).toEqual([]);
  });

  it.each([
    ['an empty site_title', { site_title: '   ' }, 'site_title', 'required'],
    ['a site_title over 100 characters', { site_title: 'a'.repeat(101) }, 'site_title', 'too_long'],
    ['a footer_text over 300 characters', { footer_text: 'a'.repeat(301) }, 'footer_text', 'too_long'],
    [
      'more than 10 social links',
      { social_links: Array.from({ length: 11 }, (_, i) => ({ label: `L${i}`, url: 'https://x.example.com' })) },
      'social_links',
      'too_long',
    ],
    ['a social link with an empty label', { social_links: [{ label: ' ', url: 'https://x.example.com' }] }, 'social_links[0].label', 'required'],
    ['a social link label over 50 characters', { social_links: [{ label: 'a'.repeat(51), url: 'https://x.example.com' }] }, 'social_links[0].label', 'too_long'],
    ['a javascript: URL', { social_links: [{ label: 'X', url: 'javascript:alert(1)' }] }, 'social_links[0].url', 'invalid_url'],
    ['a social link with an extra key', { social_links: [{ label: 'X', url: 'https://x.example.com', icon: 'y' }] }, 'social_links[0].icon', 'unknown_field'],
    ['a social link that is not an object', { social_links: ['https://x.example.com'] }, 'social_links[0]', 'type'],
  ])('rejects %s', async (_name, body, field, reason) => {
    const db = fakeDb();
    const res = await put(buildApp(db), body);
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual(expect.objectContaining({ field, reason }));
    expect(db.writes).toEqual([]);
  });

  it('rolls back every key when a write fails mid-transaction and returns a generic 500', async () => {
    const db = fakeDb({ site_title: 'Keep', footer_text: 'Keep footer' }, { failOnKey: 'footer_text' });
    const res = await put(buildApp(db), { site_title: 'Changed', footer_text: 'Changed footer' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.text).not.toContain('simulated');
    expect(db.writes.map(([k]) => k)).toEqual(['site_title', 'footer_text']);
    expect(db.stored()).toEqual({ site_title: 'Keep', footer_text: 'Keep footer' });
  });
});

describe('PUT /api/settings authorization (real adminOnly)', () => {
  const NOW = Math.floor(Date.now() / 1000);
  const adminDb = (extra) => {
    const db = fakeDb();
    return {
      ...db,
      query: async (text, params) => {
        if (/FROM admins/i.test(text)) {
          return { rows: params[0] === 7 ? [{ id: 7, email: 'owner@example.com', role: 'admin' }] : [] };
        }
        return db.query(text, params);
      },
      ...extra,
    };
  };
  const app = (db) => {
    const a = express();
    a.use(jsonBody);
    a.use('/api', createSettingsRouter({ db, config }));
    a.use(createErrorHandler({ logger: silent }));
    return a;
  };
  const token = (claims = {}) =>
    jwt.sign({ sub: '7', email: 'owner@example.com', role: 'admin', iat: NOW - 10, exp: NOW + 3600, ...claims }, SECRET, {
      algorithm: 'HS256',
    });

  it('returns 401 without a token, before validation, and writes nothing', async () => {
    const db = adminDb();
    const res = await request(app(db)).put('/api/settings').send({ theme: 'dark' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(db.writes).toEqual([]);
  });

  it('returns 403 for a non-admin role', async () => {
    const res = await request(app(adminDb()))
      .put('/api/settings')
      .set('Authorization', `Bearer ${token({ role: 'editor' })}`)
      .send({ site_title: 'X' });
    expect(res.status).toBe(403);
  });

  it('accepts a valid admin token', async () => {
    const res = await request(app(adminDb()))
      .put('/api/settings')
      .set('Authorization', `Bearer ${token()}`)
      .send({ site_title: 'X' });
    expect(res.status).toBe(200);
    expect(res.body.data.site_title).toBe('X');
  });
});
