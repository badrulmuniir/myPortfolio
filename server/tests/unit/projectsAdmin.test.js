// Admin project endpoints with a fake db (Requirements 13.1–13.6, 13.13, 13.16–13.19, 14.4, 14.5,
// 14.7, 4.12, 7.1, 7.8).
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { adminOnly } from '../../src/middleware/auth.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createProjectRouter } from '../../src/routes/project.routes.js';
import { ADMIN_PROJECT_KEYS, SQL, WRITE_COLUMNS } from '../../src/services/projectService.js';
import { SQL as TECH_SQL } from '../../src/services/technologyService.js';

const config = loadAppConfig({
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});
const silent = { info() {}, warn() {}, error() {} };

const stubAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];

const baseRow = (id, overrides = {}) => ({
  id,
  title: `Project ${id}`,
  slug: `project-${id}`,
  short_description: 'Short',
  full_description: '',
  problem_statement: '',
  objectives: '',
  challenges: '',
  solutions: '',
  category: 'Web',
  image_url: '',
  github_url: '',
  live_demo_url: '',
  display_order: 0,
  features: [],
  is_published: false,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

/**
 * In-memory model of the projects, technologies and project_technologies tables that answers
 * exactly the statements the project service sends. `withTransaction` records BEGIN, COMMIT and
 * ROLLBACK and restores the state on a throw, like the real one. `failOn` makes one statement
 * throw, to test rollback.
 */
function fakeDb({ projects = [], technologies = [], links = [], failOn } = {}) {
  let state = {
    projects: new Map(projects.map((p) => [p.id, structuredClone(p)])),
    technologies: technologies.map((t) => ({ category: '', ...t })),
    links: links.map(([p, t]) => [p, t]),
  };
  let nextProjectId = Math.max(0, ...state.projects.keys()) + 1;
  let nextTechId = Math.max(0, ...state.technologies.map((t) => t.id)) + 1;
  const calls = [];

  const techRows = (projectId) =>
    state.links
      .filter(([p]) => p === projectId)
      .map(([, t]) => state.technologies.find((x) => x.id === t))
      .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1))
      .map(({ id, name, category }) => ({ id, name, category }));
  const full = (row) => ({ ...structuredClone(row), technologies: techRows(row.id) });
  const fromParams = (params) => Object.fromEntries(WRITE_COLUMNS.map((c, i) => [c, params[i]]));

  async function query(text, params = []) {
    calls.push({ text, params });
    if (failOn && text === failOn) throw new Error('simulated failure');
    switch (text) {
      case SQL.listAdmin:
        return { rows: [...state.projects.values()].map(full) };
      case SQL.getAdmin: {
        const row = state.projects.get(params[0]);
        return { rows: row ? [full(row)] : [] };
      }
      case SQL.lockSlugs:
        return { rows: [{}] };
      case SQL.lockProject: {
        const row = state.projects.get(params[0]);
        return { rows: row ? [{ id: row.id, slug: row.slug, is_published: row.is_published }] : [] };
      }
      case SQL.slugOwner:
        return { rows: [...state.projects.values()].filter((p) => p.slug === params[0]).map((p) => ({ id: p.id })) };
      case SQL.takenSlugs:
        return { rows: [...state.projects.values()].map((p) => ({ slug: p.slug })) };
      case SQL.insert: {
        const row = baseRow(nextProjectId++, fromParams(params));
        state.projects.set(row.id, row);
        return { rows: [{ id: row.id }] };
      }
      case SQL.update: {
        const [id, ...rest] = params;
        state.projects.set(id, { ...state.projects.get(id), ...fromParams(rest) });
        return { rows: [] };
      }
      case TECH_SQL.insertMissing:
        for (const name of params[0]) {
          if (!state.technologies.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
            state.technologies.push({ id: nextTechId++, name, category: '' });
          }
        }
        return { rows: [] };
      case TECH_SQL.selectByNames:
        return {
          rows: params[0].map((n) => state.technologies.find((t) => t.name.toLowerCase() === n.toLowerCase())),
        };
      case SQL.deleteLinks:
        state.links = state.links.filter(([p]) => p !== params[0]);
        return { rows: [] };
      case SQL.insertLinks:
        for (const t of params[1]) state.links.push([params[0], t]);
        return { rows: [] };
      case SQL.setPublished: {
        const row = state.projects.get(params[0]);
        if (!row) return { rows: [] };
        row.is_published = params[1];
        return { rows: [{ id: row.id }] };
      }
      case SQL.remove: {
        const [id] = params;
        if (!state.projects.delete(id)) return { rows: [] };
        state.links = state.links.filter(([p]) => p !== id);
        return { rows: [{ id }] };
      }
      default:
        throw new Error(`unexpected query ${text}`);
    }
  }

  return {
    calls,
    get state() {
      return state;
    },
    query,
    async withTransaction(work) {
      calls.push({ text: 'BEGIN' });
      const saved = structuredClone(state);
      try {
        const result = await work({ query });
        calls.push({ text: 'COMMIT' });
        return result;
      } catch (err) {
        state = saved;
        calls.push({ text: 'ROLLBACK' });
        throw err;
      }
    },
  };
}

function setup({ db = fakeDb(), requireAdmin = stubAdmin } = {}) {
  const app = express();
  app.use(jsonBody);
  app.use('/api', createProjectRouter({ db, config, requireAdmin }));
  app.use(createErrorHandler({ logger: silent }));
  return { app, db };
}

const texts = (db) => db.calls.map((c) => c.text);
const valid = { title: 'My Portfolio', short_description: 'A site', category: 'Web', display_order: 1 };

describe('admin project SQL', () => {
  const flat = (sql) => sql.replace(/\s+/g, ' ');

  it('reads every project, published or not, with the aggregated technologies', () => {
    expect(flat(SQL.listAdmin)).toContain('WHERE TRUE GROUP BY p.id');
    expect(flat(SQL.getAdmin)).toContain('WHERE p.id = $1 GROUP BY p.id');
    expect(flat(SQL.listAdmin)).toContain('json_agg(');
  });

  it('writes only allow-listed columns through bind parameters, features as text[]', () => {
    expect(flat(SQL.insert)).toContain(`INSERT INTO projects (${WRITE_COLUMNS.join(', ')})`);
    expect(SQL.insert).toContain('$14::text[]');
    expect(SQL.update).toContain('features = $15::text[]');
    expect(SQL.update).toContain('WHERE id = $1');
  });

  it('takes the transaction-level slug lock and locks the row for update', () => {
    expect(SQL.lockSlugs).toBe("SELECT pg_advisory_xact_lock(hashtext('projects_slug'))");
    expect(SQL.lockProject).toMatch(/FOR UPDATE$/);
  });
});

describe('GET /api/admin/projects', () => {
  it('returns every project with is_published, or an empty list', async () => {
    expect((await request(setup().app).get('/api/admin/projects')).body).toEqual({ success: true, data: [] });
    const db = fakeDb({ projects: [baseRow(1, { is_published: true }), baseRow(2)] });
    const res = await request(setup({ db }).app).get('/api/admin/projects');
    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => [p.id, p.is_published])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(Object.keys(res.body.data[0])).toEqual([...ADMIN_PROJECT_KEYS]);
    expect(db.calls).toHaveLength(1);
  });
});

describe('GET /api/admin/projects/:id', () => {
  it('returns an unpublished project with its technologies', async () => {
    const db = fakeDb({ projects: [baseRow(4)], technologies: [{ id: 9, name: 'React' }], links: [[4, 9]] });
    const res = await request(setup({ db }).app).get('/api/admin/projects/4');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 4, is_published: false, technologies: [{ id: 9, name: 'React', category: '' }] });
  });

  it('returns 404 for an unknown id and 400 INVALID_ID for a bad one', async () => {
    const { app, db } = setup();
    const missing = await request(app).get('/api/admin/projects/5');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const bad = await request(app).get('/api/admin/projects/abc');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_ID');
    expect(db.calls).toHaveLength(1);
  });
});

describe('POST /api/projects', () => {
  it('creates an unpublished project with a generated slug and returns 201', async () => {
    const { app, db } = setup();
    const res = await request(app)
      .post('/api/projects')
      .send({ ...valid, title: '  My Portfolio  ', features: [' B ', 'A'], technologies: ['React', ' node '] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      id: 1,
      title: 'My Portfolio',
      slug: 'my-portfolio',
      is_published: false,
      features: ['B', 'A'],
      full_description: '',
      image_url: '',
    });
    expect(res.body.data.technologies.map((t) => t.name)).toEqual(['node', 'React']);
    expect(texts(db)).toEqual([
      'BEGIN',
      SQL.lockSlugs,
      SQL.takenSlugs,
      SQL.insert,
      TECH_SQL.insertMissing,
      TECH_SQL.selectByNames,
      SQL.deleteLinks,
      SQL.insertLinks,
      SQL.getAdmin,
      'COMMIT',
    ]);
  });

  it('appends the smallest free suffix when the derived slug is taken', async () => {
    const db = fakeDb({ projects: [baseRow(1, { slug: 'my-portfolio' }), baseRow(2, { slug: 'my-portfolio-2' })] });
    const res = await request(setup({ db }).app).post('/api/projects').send(valid);
    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('my-portfolio-3');
  });

  it('uses a supplied free slug and a supplied is_published', async () => {
    const { app, db } = setup();
    const res = await request(app).post('/api/projects').send({ ...valid, slug: ' custom-slug ', is_published: true });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ slug: 'custom-slug', is_published: true });
    expect(texts(db)).not.toContain(SQL.takenSlugs);
    expect(texts(db)).not.toContain(SQL.insertLinks);
  });

  it('returns 409 for a supplied slug that is taken and inserts nothing', async () => {
    const db = fakeDb({ projects: [baseRow(1, { slug: 'taken' })] });
    const res = await request(setup({ db }).app).post('/api/projects').send({ ...valid, slug: 'taken' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details.map((d) => d.field)).toEqual(['slug']);
    expect(texts(db)).not.toContain(SQL.insert);
    expect(texts(db).at(-1)).toBe('ROLLBACK');
    expect(db.state.projects.size).toBe(1);
  });

  it.each([
    ['an invalid slug', { slug: 'Bad Slug' }, ['slug']],
    ['a digit-only slug', { slug: '123' }, ['slug']],
    ['duplicate technologies', { technologies: ['React', 'react'] }, ['technologies[1]']],
    ['a non-boolean is_published', { is_published: 'true' }, ['is_published']],
    ['an unknown field', { id: 3 }, ['id']],
  ])('returns 400 for %s with no query', async (_name, change, fields) => {
    const { app, db } = setup();
    const res = await request(app).post('/api/projects').send({ ...valid, ...change });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toEqual(fields);
    expect(db.calls).toEqual([]);
  });

  it('rolls back every write when a step fails mid-transaction', async () => {
    const db = fakeDb({ technologies: [{ id: 1, name: 'Old' }], failOn: SQL.insertLinks });
    const before = structuredClone(db.state);
    const res = await request(setup({ db }).app).post('/api/projects').send({ ...valid, technologies: ['New'] });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(texts(db)).toContain(SQL.insert);
    expect(texts(db)).not.toContain('COMMIT');
    expect(texts(db).at(-1)).toBe('ROLLBACK');
    expect(db.state).toEqual(before);
  });
});

describe('PUT /api/projects/:id', () => {
  const existing = () =>
    fakeDb({
      projects: [baseRow(1, { slug: 'kept-slug', is_published: true, features: ['old'] }), baseRow(2, { slug: 'other' })],
      technologies: [
        { id: 1, name: 'React' },
        { id: 2, name: 'Vue' },
      ],
      links: [
        [1, 1],
        [1, 2],
      ],
    });

  it('keeps slug and is_published when omitted and replaces fields, features and technologies', async () => {
    const db = existing();
    const res = await request(setup({ db }).app)
      .put('/api/projects/1')
      .send({ ...valid, title: 'Renamed', slug: '', features: ['x', 'y'], technologies: ['vue', 'Svelte'] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: 1,
      title: 'Renamed',
      slug: 'kept-slug',
      is_published: true,
      features: ['x', 'y'],
    });
    expect(res.body.data.technologies.map((t) => t.name)).toEqual(['Svelte', 'Vue']);
    // The existing Technology keeps its stored spelling; React stays in the table (14.1, 14.7).
    expect(db.state.technologies.map((t) => t.name)).toEqual(['React', 'Vue', 'Svelte']);
    expect(texts(db)).not.toContain(SQL.slugOwner);
  });

  it('sets is_published when supplied', async () => {
    const res = await request(setup({ db: existing() }).app).put('/api/projects/1').send({ ...valid, is_published: false });
    expect(res.body.data.is_published).toBe(false);
  });

  it('removes every association for an empty technology list', async () => {
    const db = existing();
    const res = await request(setup({ db }).app).put('/api/projects/1').send({ ...valid, technologies: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.technologies).toEqual([]);
    expect(texts(db)).toContain(SQL.deleteLinks);
    expect(texts(db)).not.toContain(SQL.insertLinks);
    expect(db.state.technologies).toHaveLength(2);
  });

  it('accepts its own slug and returns 409 for a slug of another project', async () => {
    const db = existing();
    const { app } = setup({ db });
    expect((await request(app).put('/api/projects/1').send({ ...valid, slug: 'kept-slug' })).status).toBe(200);
    const before = structuredClone(db.state);
    const conflict = await request(app).put('/api/projects/1').send({ ...valid, slug: 'other' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details).toEqual([{ field: 'slug', reason: 'duplicate', message: 'This value is already in use' }]);
    expect(db.state).toEqual(before);
  });

  it('returns 404 before any slug check for an unknown id', async () => {
    const db = existing();
    const res = await request(setup({ db }).app).put('/api/projects/99').send({ ...valid, slug: 'other' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(texts(db)).toEqual(['BEGIN', SQL.lockSlugs, SQL.lockProject, 'ROLLBACK']);
  });

  it('checks the id before the body', async () => {
    const { app, db } = setup({ db: existing() });
    const res = await request(app).put('/api/projects/abc').send({});
    expect(res.body.error.code).toBe('INVALID_ID');
    expect(db.calls).toEqual([]);
  });
});

describe('PATCH /api/projects/:id/publish', () => {
  it('sets only the flag and is idempotent', async () => {
    const db = fakeDb({ projects: [baseRow(1, { features: ['a'] })], technologies: [{ id: 1, name: 'Go' }], links: [[1, 1]] });
    const { app } = setup({ db });
    const first = await request(app).patch('/api/projects/1/publish').send({ is_published: true });
    const second = await request(app).patch('/api/projects/1/publish').send({ is_published: true });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(first.body.data).toEqual({ ...baseRow(1, { features: ['a'] }), is_published: true, technologies: [{ id: 1, name: 'Go', category: '' }] });
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(setup().app).patch('/api/projects/3/publish').send({ is_published: false });
    expect(res.status).toBe(404);
  });

  it.each([[{}], [{ is_published: 'true' }], [{ is_published: 1 }]])('returns 400 naming is_published for %j', async (body) => {
    const { app, db } = setup({ db: fakeDb({ projects: [baseRow(1)] }) });
    const res = await request(app).patch('/api/projects/1/publish').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toEqual(['is_published']);
    expect(db.calls).toEqual([]);
  });
});

describe('DELETE /api/projects/:id', () => {
  it('deletes the project and its associations, keeps technologies, returns { id }', async () => {
    const db = fakeDb({ projects: [baseRow(1), baseRow(2)], technologies: [{ id: 1, name: 'Go' }], links: [[1, 1], [2, 1]] });
    const { app } = setup({ db });
    const res = await request(app).delete('/api/projects/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 1 } });
    expect([...db.state.projects.keys()]).toEqual([2]);
    expect(db.state.links).toEqual([[2, 1]]);
    expect(db.state.technologies).toHaveLength(1);
    expect((await request(app).get('/api/admin/projects/1')).status).toBe(404);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(setup().app).delete('/api/projects/1');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('admin protection with the real Auth_Middleware', () => {
  it.each([
    ['GET', '/api/admin/projects'],
    ['GET', '/api/admin/projects/1'],
    ['GET', '/api/admin/projects/abc'],
    ['POST', '/api/projects'],
    ['PUT', '/api/projects/1'],
    ['PUT', '/api/projects/abc'],
    ['PATCH', '/api/projects/1/publish'],
    ['DELETE', '/api/projects/1'],
  ])('%s %s returns 401 without a token and runs no query', async (method, path) => {
    const db = fakeDb({ projects: [baseRow(1)] });
    const { app } = setup({ db, requireAdmin: adminOnly({ db, config }) });
    const res = await request(app)[method.toLowerCase()](path).send({ ...valid, is_published: true });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(db.calls).toEqual([]);
  });
});
