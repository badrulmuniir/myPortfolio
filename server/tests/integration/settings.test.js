// GET and PUT /api/settings against the PostgreSQL test database (Requirements 11.1, 11.2, 11.3, 11.5, 11.7).
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createSettingsRouter } from '../../src/routes/settings.routes.js';
import { createSetting } from '../helpers/factories.js';
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

function buildApp(appDb = db) {
  const app = express();
  app.use(jsonBody);
  app.use('/api', createSettingsRouter({ db: appDb, config, requireAdmin: stubAdmin }));
  app.use(createErrorHandler({ logger: silent }));
  return app;
}
const app = buildApp();

beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

const storedSettings = async () => {
  const { rows } = await db.query('SELECT setting_key, setting_value FROM settings ORDER BY setting_key');
  return Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
};

describe('settings against the test database', () => {
  it('returns defaults for an empty table', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ site_title: 'My Portfolio', hero_introduction: '', footer_text: '', social_links: [] });
  });

  it('upserts only the submitted keys and leaves others unchanged', async () => {
    await createSetting(db, 'site_title', 'Old');
    await createSetting(db, 'footer_text', 'Footer');
    const res = await request(app)
      .put('/api/settings')
      .send({ site_title: ' New ', hero_introduction: 'Hi', social_links: [{ label: ' A ', url: 'https://a.example.com' }] });
    expect(res.status).toBe(200);
    const expected = {
      site_title: 'New',
      hero_introduction: 'Hi',
      footer_text: 'Footer',
      social_links: [{ label: 'A', url: 'https://a.example.com' }],
    };
    expect(res.body.data).toEqual(expected);
    expect(await storedSettings()).toEqual(expected);
    expect((await request(app).get('/api/settings')).body.data).toEqual(expected);
  });

  it('stores social_links as a JSONB array and returns it in order', async () => {
    const links = Array.from({ length: 10 }, (_, i) => ({ label: `Link ${i}`, url: `https://l${i}.example.com/` }));
    expect((await request(app).put('/api/settings').send({ social_links: links })).status).toBe(200);
    const { rows } = await db.query(
      "SELECT jsonb_typeof(setting_value) AS t FROM settings WHERE setting_key = 'social_links'",
    );
    expect(rows).toEqual([{ t: 'array' }]);
    expect((await request(app).get('/api/settings')).body.data.social_links).toEqual(links);
  });

  it('leaves the table unchanged when the body mixes valid and invalid keys', async () => {
    await createSetting(db, 'site_title', 'Keep');
    const before = await snapshot(db, ['settings']);
    for (const body of [{ site_title: 'X', theme: 'dark' }, { site_title: 'X', footer_text: 7 }, {}]) {
      expect((await request(app).put('/api/settings').send(body)).status).toBe(400);
    }
    expect(await snapshot(db, ['settings'])).toEqual(before);
  });

  it('rolls back earlier keys when a later write fails', async () => {
    await createSetting(db, 'site_title', 'Keep');
    let calls = 0;
    const failingDb = {
      query: (text, params) => db.query(text, params),
      withTransaction: (work) =>
        db.withTransaction((tx) =>
          work({
            query: (text, params) => {
              calls += 1;
              if (calls === 2) throw new Error('simulated failure');
              return tx.query(text, params);
            },
          }),
        ),
    };
    const res = await request(buildApp(failingDb)).put('/api/settings').send({ site_title: 'Changed', footer_text: 'New' });
    expect(res.status).toBe(500);
    expect(await storedSettings()).toEqual({ site_title: 'Keep' });
  });
});
