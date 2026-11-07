// Public project endpoints with a fake db (Requirements 9.1, 12.1–12.6, 12.8–12.10, 4.10, 35.10).
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createProjectRouter } from '../../src/routes/project.routes.js';
import { PUBLIC_PROJECT_KEYS, SQL, toAdminProject } from '../../src/services/projectService.js';

const config = loadAppConfig({
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});
const silent = { info() {}, warn() {}, error() {} };

/** Admin middleware that must never run on a public route. */
const forbiddenAdmin = [(req, res) => res.status(418).end()];

const row = (overrides) => ({
  id: 1,
  title: 'Portfolio',
  slug: 'portfolio',
  short_description: 'A site',
  full_description: 'Full',
  problem_statement: 'Problem',
  objectives: 'Objectives',
  challenges: 'Challenges',
  solutions: 'Solutions',
  category: 'Web',
  image_url: 'https://example.com/a.png',
  github_url: 'https://github.com/x/y',
  live_demo_url: '',
  display_order: 0,
  features: ['Second', 'First'],
  is_published: true,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-02T00:00:00.000Z',
  technologies: [{ id: 2, name: 'React', category: '' }],
  ...overrides,
});

/**
 * Fake db that answers the three public statements the way their WHERE clauses do:
 * unpublished rows are never returned. Records every statement.
 */
function fakeDb(rows = []) {
  const calls = [];
  const published = () => rows.filter((r) => r.is_published).map((r) => ({ ...r }));
  return {
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      if (text === SQL.listPublic) {
        const [category] = params;
        return { rows: published().filter((r) => category === null || r.category.toLowerCase() === category.toLowerCase()) };
      }
      if (text === SQL.getPublicById) return { rows: published().filter((r) => r.id === params[0]) };
      if (text === SQL.getPublicBySlug) return { rows: published().filter((r) => r.slug === params[0]) };
      throw new Error(`unexpected query ${text}`);
    },
  };
}

function setup(db = fakeDb()) {
  const app = express();
  app.use(jsonBody);
  app.use('/api', createProjectRouter({ db, config, requireAdmin: forbiddenAdmin }));
  app.use(createErrorHandler({ logger: silent }));
  return { app, db };
}

const notFoundBody = { success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } };
const publicOf = (r) => {
  const rest = { ...r };
  delete rest.is_published;
  return rest;
};

describe('project read SQL', () => {
  const flat = (sql) => sql.replace(/\s+/g, ' ');

  it('aggregates technologies in one statement and filters by is_published', () => {
    const sql = flat(SQL.listPublic);
    expect(sql).toContain('json_agg(');
    expect(sql).toContain('LEFT JOIN project_technologies pt ON pt.project_id = p.id');
    expect(sql).toContain('LEFT JOIN technologies t ON t.id = pt.technology_id');
    expect(sql).toContain('GROUP BY p.id');
    expect(sql).toMatch(/WHERE p\.is_published AND/);
    expect(sql).toContain('ORDER BY lower(t.name) COLLATE "C", t.id');
    expect(sql.split('GROUP BY p.id ORDER BY ')[1]).toBe('p.display_order ASC, p.created_at DESC, p.id DESC');
  });

  it('compares category case-insensitively through a bind parameter', () => {
    expect(flat(SQL.listPublic)).toContain('lower(p.category) = lower($1::text)');
  });

  it('looks up a single project by id or exact slug, published only', () => {
    expect(flat(SQL.getPublicById)).toMatch(/WHERE p\.is_published AND p\.id = \$1 GROUP BY/);
    expect(flat(SQL.getPublicBySlug)).toMatch(/WHERE p\.is_published AND p\.slug = \$1 GROUP BY/);
  });
});

describe('GET /api/projects', () => {
  it('returns published projects in database order with one query and no admin-only fields', async () => {
    const rows = [row({ id: 1 }), row({ id: 2, slug: 'hidden', is_published: false }), row({ id: 3, slug: 'other' })];
    const { app, db } = setup(fakeDb(rows));
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [publicOf(rows[0]), publicOf(rows[2])] });
    expect(Object.keys(res.body.data[0])).toEqual([...PUBLIC_PROJECT_KEYS]);
    expect(res.body.data[0]).not.toHaveProperty('is_published');
    expect(res.body.data[0].features).toEqual(['Second', 'First']);
    expect(db.calls).toEqual([{ text: SQL.listPublic, params: [null] }]);
  });

  it('returns an empty list when nothing is published', async () => {
    const { app, db } = setup(fakeDb([row({ is_published: false })]));
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(db.calls).toHaveLength(1);
  });

  it('passes the trimmed category as a bind value, never in the SQL text', async () => {
    const { app, db } = setup(fakeDb([row({ category: 'Web' }), row({ id: 2, slug: 'm', category: 'Mobile' })]));
    const res = await request(app).get('/api/projects').query({ category: "  wEB' OR 1=1 --  " });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(db.calls).toEqual([{ text: SQL.listPublic, params: ["wEB' OR 1=1 --"] }]);
    expect(SQL.listPublic).not.toContain('OR 1=1');

    const web = await request(app).get('/api/projects?category=WEB');
    expect(web.body.data.map((p) => p.id)).toEqual([1]);
  });

  it('ignores unknown query parameters', async () => {
    const { app, db } = setup(fakeDb([row()]));
    const res = await request(app).get('/api/projects?utm_source=x');
    expect(res.status).toBe(200);
    expect(db.calls).toEqual([{ text: SQL.listPublic, params: [null] }]);
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
    ['51 characters', 'x'.repeat(51)],
  ])('returns 400 for a %s category with no query', async (_name, category) => {
    const { app, db } = setup(fakeDb([row()]));
    const res = await request(app).get('/api/projects').query({ category });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toEqual(['category']);
    expect(db.calls).toEqual([]);
  });
});

describe('GET /api/projects/:identifier', () => {
  const rows = [row({ id: 7, slug: 'my-project' }), row({ id: 8, slug: 'draft', is_published: false })];

  it('looks up a digit-only identifier by id, leading zeros allowed', async () => {
    const { app, db } = setup(fakeDb(rows));
    const res = await request(app).get('/api/projects/007');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: publicOf(rows[0]) });
    expect(db.calls).toEqual([{ text: SQL.getPublicById, params: [7] }]);
  });

  it('looks up any other valid identifier by exact slug', async () => {
    const { app, db } = setup(fakeDb(rows));
    const res = await request(app).get('/api/projects/my-project');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(publicOf(rows[0]));
    expect(res.body.data).not.toHaveProperty('is_published');
    expect(db.calls).toEqual([{ text: SQL.getPublicBySlug, params: ['my-project'] }]);
  });

  it.each(['8', 'draft'])('returns the same 404 for unpublished project %j as for a missing one', async (identifier) => {
    const { app } = setup(fakeDb(rows));
    const unpublished = await request(app).get(`/api/projects/${identifier}`);
    const missing = await request(app).get(`/api/projects/${identifier === '8' ? '999' : 'no-such-project'}`);
    expect(unpublished.status).toBe(404);
    expect(unpublished.body).toEqual(notFoundBody);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(unpublished.body);
  });

  it.each(['My-Project', 'my--project', '-x', '123-'])('returns 404 without a query for non-slug %j', async (identifier) => {
    const { app, db } = setup(fakeDb(rows));
    const res = await request(app).get(`/api/projects/${encodeURIComponent(identifier)}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(notFoundBody);
    expect(db.calls).toEqual([]);
  });

  it.each(['0', '2147483648'])('returns 400 INVALID_ID for %j with no query', async (identifier) => {
    const { app, db } = setup(fakeDb(rows));
    const res = await request(app).get(`/api/projects/${identifier}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
    expect(db.calls).toEqual([]);
  });
});

describe('public access', () => {
  it.each(['/api/projects', '/api/projects/7', '/api/projects/my-project', '/api/projects/8'])(
    '%s gives the same response with a garbage Authorization header',
    async (path) => {
      const { app } = setup(fakeDb([row({ id: 7, slug: 'my-project' }), row({ id: 8, slug: 'draft', is_published: false })]));
      const plain = await request(app).get(path);
      const withHeader = await request(app).get(path).set('Authorization', 'Bearer not.a.jwt');
      expect(withHeader.status).toBe(plain.status);
      expect(withHeader.body).toEqual(plain.body);
      expect([401, 403, 418]).not.toContain(withHeader.status);
    },
  );
});

describe('toAdminProject', () => {
  it('adds is_published to the public shape', () => {
    expect(toAdminProject(row({ is_published: false }))).toEqual({ ...publicOf(row()), is_published: false });
  });
});
