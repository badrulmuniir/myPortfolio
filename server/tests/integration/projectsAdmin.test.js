// Admin project endpoints against the PostgreSQL test database
// (Requirements 13.1–13.6, 13.11, 13.15–13.18, 14.1, 14.2, 14.4, 14.5, 14.7).
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createProjectRouter } from '../../src/routes/project.routes.js';
import { ADMIN_PROJECT_KEYS, SQL } from '../../src/services/projectService.js';
import { createProject, createTechnology, linkProjectTechnology } from '../helpers/factories.js';
import { closeTestDb, getTestDb, resetDb, snapshot } from '../helpers/testDb.js';

const config = loadAppConfig({
  JWT_SECRET: 'integration-test-secret-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  // Only used by the config loader; the router uses the injected test db.
  DATABASE_URL: 'postgres://unused@localhost:5432/unused',
});
const db = getTestDb();
const silent = { info() {}, warn() {}, error() {} };
const TABLES = ['projects', 'technologies', 'project_technologies'];

// Admin protection is covered by the auth tests and the unit tests; here it is a stub.
const requireAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];

function buildApp(appDb = db) {
  const app = express();
  app.use(jsonBody);
  app.use('/api', createProjectRouter({ db: appDb, config, requireAdmin }));
  app.use(createErrorHandler({ logger: silent }));
  return app;
}
const app = buildApp();

/**
 * The real test db, except that inside a transaction the statement `failText` throws after the
 * earlier statements of that transaction have run against PostgreSQL.
 */
function failingDb(failText) {
  return {
    query: (text, params) => db.query(text, params),
    withTransaction: (work) =>
      db.withTransaction((tx) =>
        work({
          query: (text, params) =>
            text === failText ? Promise.reject(new Error('simulated failure')) : tx.query(text, params),
        }),
      ),
  };
}

beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

const fullPayload = {
  title: '  Task Tracker  ',
  short_description: 'Tracks tasks',
  full_description: 'Full text\nwith lines',
  problem_statement: 'Problem',
  objectives: 'Objectives',
  challenges: 'Challenges',
  solutions: 'Solutions',
  category: 'Web',
  image_url: 'https://example.com/i.png',
  github_url: 'https://github.com/me/tracker',
  live_demo_url: 'https://tracker.example.com',
  display_order: 3,
  features: ['Zeta', ' alpha ', 'Mid'],
  technologies: ['React', ' node.js ', 'PostgreSQL'],
};
const names = (project) => project.technologies.map((t) => t.name.toLowerCase()).sort();

describe('project create and read', () => {
  it('round-trips every field, features in order and the technology set', async () => {
    const existing = await createTechnology(db, { name: 'react', category: 'Frontend' });
    const created = await request(app).post('/api/projects').send(fullPayload);
    expect(created.status).toBe(201);
    const { id } = created.body.data;

    const read = await request(app).get(`/api/admin/projects/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.data).toEqual(created.body.data);
    expect(Object.keys(read.body.data)).toEqual([...ADMIN_PROJECT_KEYS]);
    expect(read.body.data).toMatchObject({
      title: 'Task Tracker',
      slug: 'task-tracker',
      short_description: 'Tracks tasks',
      full_description: 'Full text\nwith lines',
      problem_statement: 'Problem',
      objectives: 'Objectives',
      challenges: 'Challenges',
      solutions: 'Solutions',
      category: 'Web',
      image_url: 'https://example.com/i.png',
      github_url: 'https://github.com/me/tracker',
      live_demo_url: 'https://tracker.example.com',
      display_order: 3,
      features: ['Zeta', 'alpha', 'Mid'],
      is_published: false,
    });
    expect(names(read.body.data)).toEqual(['node.js', 'postgresql', 'react']);
    // The matching Technology is reused with its stored name and category (14.1); new ones get
    // the submitted spelling and an empty category (14.2).
    expect(read.body.data.technologies).toContainEqual({ id: existing.id, name: 'react', category: 'Frontend' });
    expect(read.body.data.technologies).toContainEqual(expect.objectContaining({ name: 'node.js', category: '' }));
    const { rows } = await db.query('SELECT count(*)::int AS n FROM technologies');
    expect(rows[0].n).toBe(3);
  });

  it('generates the smallest free suffix when the derived slug is taken', async () => {
    await createProject(db, { slug: 'my-app' });
    await createProject(db, { slug: 'my-app-3' });
    const res = await request(app).post('/api/projects').send({ title: 'My App!', short_description: 'x', category: 'Web', display_order: 0 });
    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('my-app-2');
  });

  it('returns 409 for a supplied slug that is taken and changes nothing', async () => {
    await createProject(db, { slug: 'taken-slug' });
    const before = await snapshot(db, TABLES);
    const res = await request(app).post('/api/projects').send({ ...fullPayload, slug: 'taken-slug' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.map((d) => d.field)).toEqual(['slug']);
    expect(await snapshot(db, TABLES)).toEqual(before);
  });

  it('lists every project for the admin, newest first within a display_order', async () => {
    expect((await request(app).get('/api/admin/projects')).body.data).toEqual([]);
    const a = await createProject(db, { display_order: 1, is_published: true });
    const b = await createProject(db, { display_order: 0, created_at: '2024-01-01T00:00:00Z' });
    const c = await createProject(db, { display_order: 0, created_at: '2024-06-01T00:00:00Z' });
    const res = await request(app).get('/api/admin/projects');
    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => [p.id, p.is_published])).toEqual([
      [c.id, false],
      [b.id, false],
      [a.id, true],
    ]);
  });
});

describe('publication flow', () => {
  it('keeps a new project private until published and hides it again after unpublishing', async () => {
    const { id, slug } = (await request(app).post('/api/projects').send(fullPayload)).body.data;

    expect((await request(app).get('/api/admin/projects')).body.data.map((p) => p.id)).toEqual([id]);
    expect((await request(app).get(`/api/projects/${id}`)).status).toBe(404);
    expect((await request(app).get(`/api/projects/${slug}`)).status).toBe(404);
    expect((await request(app).get('/api/projects')).body.data).toEqual([]);

    const before = (await request(app).get(`/api/admin/projects/${id}`)).body.data;
    const published = await request(app).patch(`/api/projects/${id}/publish`).send({ is_published: true });
    expect(published.status).toBe(200);
    const { updated_at: _u1, ...publishedRest } = published.body.data;
    const { updated_at: _u0, ...beforeRest } = before;
    expect(publishedRest).toEqual({ ...beforeRest, is_published: true });

    expect((await request(app).get(`/api/projects/${slug}`)).status).toBe(200);
    expect((await request(app).get(`/api/projects/${id}`)).body.data).not.toHaveProperty('is_published');
    expect((await request(app).get('/api/projects')).body.data.map((p) => p.id)).toEqual([id]);

    // Same value again is still 200 (13.5).
    expect((await request(app).patch(`/api/projects/${id}/publish`).send({ is_published: true })).status).toBe(200);

    const unpublished = await request(app).patch(`/api/projects/${id}/publish`).send({ is_published: false });
    expect(unpublished.body.data.is_published).toBe(false);
    expect((await request(app).get(`/api/projects/${slug}`)).status).toBe(404);
    expect((await request(app).get('/api/projects')).body.data).toEqual([]);
  });

  it('returns 404 for publish on an unknown id', async () => {
    const res = await request(app).patch('/api/projects/999/publish').send({ is_published: true });
    expect(res.status).toBe(404);
  });
});

describe('project update', () => {
  it('replaces fields and technologies, keeps slug, is_published and unused technology rows', async () => {
    const created = (await request(app).post('/api/projects').send({ ...fullPayload, is_published: true })).body.data;
    const res = await request(app)
      .put(`/api/projects/${created.id}`)
      .send({ title: 'Renamed', short_description: 'New', category: 'Mobile', display_order: 0, features: ['one'], technologies: ['REACT', 'Swift'] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: created.id,
      title: 'Renamed',
      slug: 'task-tracker',
      is_published: true,
      category: 'Mobile',
      full_description: '',
      image_url: '',
      features: ['one'],
    });
    expect(names(res.body.data)).toEqual(['react', 'swift']);
    expect((await request(app).get(`/api/admin/projects/${created.id}`)).body.data).toEqual(res.body.data);

    const { rows } = await db.query('SELECT name FROM technologies ORDER BY id');
    expect(rows.map((r) => r.name)).toEqual(['React', 'node.js', 'PostgreSQL', 'Swift']);

    const cleared = await request(app).put(`/api/projects/${created.id}`).send({ ...fullPayload, technologies: [] });
    expect(cleared.body.data.technologies).toEqual([]);
    const links = await db.query('SELECT count(*)::int AS n FROM project_technologies');
    expect(links.rows[0].n).toBe(0);
  });

  it('returns 404 for an unknown id and 409 for another project slug, changing nothing', async () => {
    const p = await createProject(db, { slug: 'first' });
    await createProject(db, { slug: 'second' });
    const before = await snapshot(db, TABLES);
    const missing = await request(app).put('/api/projects/999').send({ ...fullPayload, slug: 'second' });
    expect(missing.status).toBe(404);
    const conflict = await request(app).put(`/api/projects/${p.id}`).send({ ...fullPayload, slug: 'second' });
    expect(conflict.status).toBe(409);
    expect(await snapshot(db, TABLES)).toEqual(before);
  });
});

describe('project delete', () => {
  it('removes the project and its associations but keeps every technology', async () => {
    const p = await createProject(db, { is_published: true });
    const other = await createProject(db);
    const t = await createTechnology(db, { name: 'Go' });
    await linkProjectTechnology(db, p.id, t.id);
    await linkProjectTechnology(db, other.id, t.id);

    const res = await request(app).delete(`/api/projects/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: p.id } });
    expect((await request(app).get(`/api/admin/projects/${p.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/projects/${p.slug}`)).status).toBe(404);

    const links = await db.query('SELECT project_id FROM project_technologies');
    expect(links.rows).toEqual([{ project_id: other.id }]);
    const techs = await db.query('SELECT id FROM technologies');
    expect(techs.rows).toEqual([{ id: t.id }]);

    expect((await request(app).delete(`/api/projects/${p.id}`)).status).toBe(404);
  });
});

describe('save transaction rollback', () => {
  it('leaves projects, technologies and associations unchanged when create fails late', async () => {
    await createTechnology(db, { name: 'React' });
    const before = await snapshot(db, TABLES);
    const res = await request(buildApp(failingDb(SQL.insertLinks))).post('/api/projects').send(fullPayload);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
    expect(await snapshot(db, TABLES)).toEqual(before);
  });

  it('leaves the project and its associations unchanged when update fails late', async () => {
    const p = await createProject(db, { title: 'Original' });
    const t = await createTechnology(db, { name: 'Vue' });
    await linkProjectTechnology(db, p.id, t.id);
    const before = await snapshot(db, TABLES);
    const res = await request(buildApp(failingDb(SQL.insertLinks)))
      .put(`/api/projects/${p.id}`)
      .send({ ...fullPayload, technologies: ['Svelte'] });
    expect(res.status).toBe(500);
    expect(await snapshot(db, TABLES)).toEqual(before);
  });
});
