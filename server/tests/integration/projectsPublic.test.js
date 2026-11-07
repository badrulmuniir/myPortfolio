// Public project endpoints against the PostgreSQL test database
// (Requirements 12.1–12.5, 12.7–12.9, 35.10).
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createProjectRouter } from '../../src/routes/project.routes.js';
import { PUBLIC_PROJECT_KEYS } from '../../src/services/projectService.js';
import { createProject, createTechnology, linkProjectTechnology } from '../helpers/factories.js';
import { closeTestDb, getTestDb, resetDb } from '../helpers/testDb.js';

const config = loadAppConfig({
  JWT_SECRET: 'integration-test-secret-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  // Only used by the config loader; the router uses the injected test db.
  DATABASE_URL: 'postgres://unused@localhost:5432/unused',
});
const db = getTestDb();

/** Counts statements so the single-query rule (35.10) can be checked. */
let queryCount = 0;
const countingDb = {
  query(text, params) {
    queryCount += 1;
    return db.query(text, params);
  },
};

const app = express();
app.use(jsonBody);
app.use('/api', createProjectRouter({ db: countingDb, config, requireAdmin: [(req, res) => res.status(418).end()] }));
app.use(createErrorHandler({ logger: { info() {}, warn() {}, error() {} } }));

beforeEach(async () => {
  await resetDb(db);
  queryCount = 0;
});
afterAll(() => closeTestDb());

const notFoundBody = { success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } };
const ids = (res) => res.body.data.map((p) => p.id);

describe('GET /api/projects', () => {
  it('returns an empty list when no project exists or none is published', async () => {
    expect((await request(app).get('/api/projects')).body).toEqual({ success: true, data: [] });
    await createProject(db, { is_published: false });
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('returns exactly the published projects, by display_order then created_at descending', async () => {
    const a = await createProject(db, { is_published: true, display_order: 2, created_at: '2024-01-01T00:00:00Z' });
    const b = await createProject(db, { is_published: true, display_order: 1, created_at: '2024-01-01T00:00:00Z' });
    const c = await createProject(db, { is_published: true, display_order: 2, created_at: '2024-06-01T00:00:00Z' });
    await createProject(db, { is_published: false, display_order: 0 });

    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([b.id, c.id, a.id]);
    expect(Object.keys(res.body.data[0])).toEqual([...PUBLIC_PROJECT_KEYS]);
    expect(res.body.data[0]).not.toHaveProperty('is_published');
  });

  it('filters by category case-insensitively', async () => {
    const web = await createProject(db, { is_published: true, category: 'Web' });
    const web2 = await createProject(db, { is_published: true, category: 'WEB', display_order: 1 });
    await createProject(db, { is_published: false, category: 'web' });
    await createProject(db, { is_published: true, category: 'Mobile' });

    expect(ids(await request(app).get('/api/projects?category=wEb'))).toEqual([web.id, web2.id]);
    const none = await request(app).get('/api/projects?category=Desktop');
    expect(none.status).toBe(200);
    expect(none.body.data).toEqual([]);
  });

  it('includes technologies ordered by name and keeps features in stored order', async () => {
    const p = await createProject(db, { is_published: true, features: ['Zeta', 'alpha', 'Mid'] });
    const empty = await createProject(db, { is_published: true, display_order: 1 });
    const vue = await createTechnology(db, { name: 'vue' });
    const css = await createTechnology(db, { name: 'CSS', category: 'Styling' });
    const react = await createTechnology(db, { name: 'React' });
    for (const t of [vue, css, react]) await linkProjectTechnology(db, p.id, t.id);

    const res = await request(app).get('/api/projects');
    const [first, second] = res.body.data;
    expect(first.id).toBe(p.id);
    expect(first.features).toEqual(['Zeta', 'alpha', 'Mid']);
    expect(first.technologies).toEqual([
      { id: css.id, name: 'CSS', category: 'Styling' },
      { id: react.id, name: 'React', category: '' },
      { id: vue.id, name: 'vue', category: '' },
    ]);
    expect(second.id).toBe(empty.id);
    expect(second.technologies).toEqual([]);
  });

  it('uses the same number of queries for 0, 1 and 200 projects', async () => {
    const counts = [];
    const tech = await createTechnology(db, { name: 'Node' });
    for (const target of [0, 1, 200]) {
      const { rows } = await db.query('SELECT count(*)::int AS n FROM projects');
      for (let i = rows[0].n; i < target; i += 1) {
        const p = await createProject(db, { is_published: true });
        await linkProjectTechnology(db, p.id, tech.id);
      }
      queryCount = 0;
      const res = await request(app).get('/api/projects');
      expect(res.body.data).toHaveLength(target);
      counts.push(queryCount);
    }
    expect(counts).toEqual([1, 1, 1]);
  });
});

describe('GET /api/projects/:identifier', () => {
  it('returns a published project by id and by slug with every detail field', async () => {
    const p = await createProject(db, {
      is_published: true,
      slug: 'my-project',
      full_description: 'Full',
      problem_statement: 'Problem',
      objectives: 'Goals',
      challenges: 'Hard parts',
      solutions: 'Fixes',
      image_url: 'https://example.com/i.png',
      github_url: 'https://github.com/me/p',
      live_demo_url: 'https://demo.example.com',
      display_order: 5,
      features: ['B', 'A'],
    });
    const t = await createTechnology(db, { name: 'Express' });
    await linkProjectTechnology(db, p.id, t.id);

    const byId = await request(app).get(`/api/projects/${p.id}`);
    expect(byId.status).toBe(200);
    expect(byId.body.data).toMatchObject({
      id: p.id,
      title: p.title,
      slug: 'my-project',
      short_description: p.short_description,
      full_description: 'Full',
      problem_statement: 'Problem',
      objectives: 'Goals',
      challenges: 'Hard parts',
      solutions: 'Fixes',
      category: 'Web',
      image_url: 'https://example.com/i.png',
      github_url: 'https://github.com/me/p',
      live_demo_url: 'https://demo.example.com',
      display_order: 5,
      features: ['B', 'A'],
      technologies: [{ id: t.id, name: 'Express', category: '' }],
    });
    expect(byId.body.data).not.toHaveProperty('is_published');

    const bySlug = await request(app).get('/api/projects/my-project');
    expect(bySlug.status).toBe(200);
    expect(bySlug.body).toEqual(byId.body);
  });

  it('returns the same 404 for an unpublished project as for a missing one, by id and by slug', async () => {
    const draft = await createProject(db, { is_published: false, slug: 'draft-project' });
    const responses = await Promise.all(
      [`/api/projects/${draft.id}`, '/api/projects/draft-project', '/api/projects/999999', '/api/projects/no-such-project'].map(
        (path) => request(app).get(path),
      ),
    );
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(notFoundBody);
    }
  });

  it('matches slugs case-sensitively and answers non-slug identifiers with 404 and no query', async () => {
    await createProject(db, { is_published: true, slug: 'my-project' });
    queryCount = 0;
    const res = await request(app).get('/api/projects/My-Project');
    expect(res.status).toBe(404);
    expect(res.body).toEqual(notFoundBody);
    expect(queryCount).toBe(0);
  });

  it('returns 400 INVALID_ID for a digit-only identifier outside 1..2147483647', async () => {
    const res = await request(app).get('/api/projects/0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
  });

  it('shows a project after publication and hides it again after unpublishing', async () => {
    const p = await createProject(db, { is_published: false });
    expect((await request(app).get(`/api/projects/${p.slug}`)).status).toBe(404);
    await db.query('UPDATE projects SET is_published = true WHERE id = $1', [p.id]);
    expect((await request(app).get(`/api/projects/${p.slug}`)).status).toBe(200);
    expect(ids(await request(app).get('/api/projects'))).toEqual([p.id]);
    await db.query('UPDATE projects SET is_published = false WHERE id = $1', [p.id]);
    expect((await request(app).get(`/api/projects/${p.id}`)).body).toEqual(notFoundBody);
    expect((await request(app).get('/api/projects')).body.data).toEqual([]);
  });
});
