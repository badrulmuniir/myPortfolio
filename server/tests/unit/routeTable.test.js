// The route table matches the mounted API router (Requirements 4.4, 7.1, 7.6).
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAppConfig } from '../../src/config/env.js';
import { notFound } from '../../src/middleware/notFound.js';
import { createApiRouter, listRoutes, ROUTES } from '../../src/routes/index.js';

const config = loadAppConfig({
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});
const silent = { info() {}, warn() {}, error() {} };

/** Fake db: healthy, and every query returns no rows (empty lists, no profile, no admin). */
function fakeDb() {
  const db = {
    healthCheck: async () => true,
    query: async () => ({ rows: [], rowCount: 0 }),
    withTransaction: async (fn) => fn(db),
  };
  return db;
}

/**
 * Walks an Express 5 router and returns every (method, path) pair it serves. Nested routers
 * must be mounted without a path (`router.use(sub)`), which is how routes/index.js mounts them.
 */
function collectRoutes(router, prefix = '') {
  const found = [];
  for (const layer of router.stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        found.push(`${method.toUpperCase()} ${prefix}${layer.route.path}`);
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      if (!layer.slash) throw new Error('collectRoutes supports only routers mounted without a path');
      found.push(...collectRoutes(layer.handle, prefix));
    }
  }
  return found;
}

const key = ({ method, path }) => `${method} ${path}`;
const concrete = (path) => path.replace(':identifier', 'some-slug').replace(':id', '1');
const send = (app, { method, path }) => request(app)[method.toLowerCase()](concrete(path));

// Requirement 7.1 (admin) and 7.6 (public) endpoint lists, written out independently of ROUTES.
const ADMIN_7_1 = [
  'GET /api/auth/me',
  'PUT /api/profile',
  'GET /api/admin/projects',
  'GET /api/admin/projects/:id',
  'POST /api/projects',
  'PUT /api/projects/:id',
  'PATCH /api/projects/:id/publish',
  'DELETE /api/projects/:id',
  'GET /api/technologies',
  ...['skills', 'experiences', 'education'].flatMap((r) => [
    `POST /api/${r}`,
    `PUT /api/${r}/:id`,
    `DELETE /api/${r}/:id`,
  ]),
  'GET /api/contact',
  'GET /api/contact/:id',
  'PATCH /api/contact/:id/read',
  'DELETE /api/contact/:id',
  'GET /api/dashboard/stats',
  'PUT /api/settings',
];
const PUBLIC_7_6 = [
  'POST /api/auth/login',
  'GET /api/health',
  'GET /api/profile',
  'GET /api/projects',
  'GET /api/projects/:identifier',
  'GET /api/skills',
  'GET /api/experiences',
  'GET /api/education',
  'GET /api/settings',
  'POST /api/contact',
];

describe('listRoutes', () => {
  it('returns copies of the table entries with valid fields and no duplicates', () => {
    const routes = listRoutes();
    expect(routes).toEqual(ROUTES);
    routes[0].auth = 'changed';
    expect(ROUTES[0].auth).toBe('public');
    for (const r of ROUTES) {
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(r.method);
      expect(r.path.startsWith('/api/')).toBe(true);
      expect(['public', 'admin']).toContain(r.auth);
    }
    expect(new Set(ROUTES.map(key)).size).toBe(ROUTES.length);
  });

  it('classifies endpoints exactly as Requirements 7.1 and 7.6 do', () => {
    const byAuth = (auth) => ROUTES.filter((r) => r.auth === auth).map(key).sort();
    expect(byAuth('admin')).toEqual([...ADMIN_7_1].sort());
    expect(byAuth('public')).toEqual([...PUBLIC_7_6].sort());
  });
});

describe('the mounted /api router', () => {
  const router = createApiRouter({ config, db: fakeDb(), logger: silent });

  it('serves exactly the (method, path) pairs in the route table', () => {
    const mounted = collectRoutes(router, '/api');
    expect(new Set(mounted).size).toBe(mounted.length);
    expect([...mounted].sort()).toEqual(ROUTES.map(key).sort());
  });

  it('mounts notFound last', () => {
    expect(router.stack.at(-1).handle).toBe(notFound);
  });
});

describe('auth values match the behavior', () => {
  const app = createApp({ config, db: fakeDb(), logger: silent });

  it.each(ROUTES.filter((r) => r.auth === 'admin'))('$method $path returns 401 without a token', async (route) => {
    const res = await send(app, route).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.data).toBeUndefined();
  });

  it.each(ROUTES.filter((r) => r.auth === 'public'))('$method $path never returns 401 or 403', async (route) => {
    // An empty body keeps POST /auth/login and POST /contact at validation (400), so login
    // never reaches the credential check and nothing is stored.
    const req = send(app, route);
    const res = route.method === 'GET' ? await req : await req.send({});
    expect([401, 403]).not.toContain(res.status);
    expect(res.body.error?.code).not.toBe('ROUTE_NOT_FOUND');
  });

  it('answers a path outside the table with 404 ROUTE_NOT_FOUND', async () => {
    const res = await request(app).get('/api/not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
