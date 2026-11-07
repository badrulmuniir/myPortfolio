// Technology service and endpoint against the PostgreSQL test database (Requirements 14.1, 14.2, 14.3).
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createTechnologyRouter } from '../../src/routes/technology.routes.js';
import { createTechnologyService } from '../../src/services/technologyService.js';
import { createTechnology } from '../helpers/factories.js';
import { closeTestDb, getTestDb, resetDb, snapshot } from '../helpers/testDb.js';

const config = loadAppConfig({
  JWT_SECRET: 'integration-test-secret-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  // Only used by the config loader; the router uses the injected test db.
  DATABASE_URL: 'postgres://unused@localhost:5432/unused',
});
const db = getTestDb();
const service = createTechnologyService({ db });

const requireAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];
const app = express();
app.use(jsonBody);
app.use('/api', createTechnologyRouter({ db, config, requireAdmin }));
app.use(createErrorHandler({ logger: { info() {}, warn() {}, error() {} } }));

beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

const allTechnologies = async () =>
  (await db.query('SELECT id, name, category FROM technologies ORDER BY id')).rows;

describe('GET /api/technologies', () => {
  it('returns an empty list when no technology exists', async () => {
    const res = await request(app).get('/api/technologies');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('lists every technology once, ordered by name case-insensitively in code-point order', async () => {
    for (const name of ['react', 'Angular', 'node.js', 'Vue', 'CSS', 'c#', 'Go']) await createTechnology(db, { name });
    await createTechnology(db, { name: 'Bootstrap', category: 'Frontend' });

    const rows = await allTechnologies();
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const expected = [...rows].sort((a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()) || a.id - b.id);

    const res = await request(app).get('/api/technologies');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expected);
    expect(res.body.data.map((t) => t.name)).toEqual(['Angular', 'Bootstrap', 'c#', 'CSS', 'Go', 'node.js', 'react', 'Vue']);
    expect(res.body.data.find((t) => t.name === 'Bootstrap').category).toBe('Frontend');
  });
});

describe('ensureByNames', () => {
  it('creates unknown names and reuses existing ones case-insensitively, in input order', async () => {
    const react = await createTechnology(db, { name: 'React', category: 'Frontend' });

    const ids = await db.withTransaction((tx) => service.ensureByNames(tx, ['TypeScript', 'react', 'Vite']));

    const rows = await allTechnologies();
    expect(rows).toEqual([
      { id: react.id, name: 'React', category: 'Frontend' }, // stored name and category kept (14.1)
      { id: expect.any(Number), name: 'TypeScript', category: '' }, // submitted case, empty category (14.2)
      { id: expect.any(Number), name: 'Vite', category: '' },
    ]);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.id]));
    expect(ids).toEqual([byName.TypeScript, react.id, byName.Vite]);
  });

  it('returns no ids and writes nothing for an empty list', async () => {
    await createTechnology(db, { name: 'React' });
    const before = await snapshot(db, ['technologies']);
    expect(await db.withTransaction((tx) => service.ensureByNames(tx, []))).toEqual([]);
    expect(await snapshot(db, ['technologies'])).toEqual(before);
  });

  it('keeps one row per name when the same name is ensured twice or in different case', async () => {
    const first = await db.withTransaction((tx) => service.ensureByNames(tx, ['Docker']));
    const second = await db.withTransaction((tx) => service.ensureByNames(tx, ['DOCKER', 'docker']));
    expect(second).toEqual(first);
    expect(await allTechnologies()).toEqual([{ id: first[0], name: 'Docker', category: '' }]);
  });

  it('handles two concurrent transactions inserting the same name through ON CONFLICT', async () => {
    const [a, b] = await Promise.all([
      db.withTransaction((tx) => service.ensureByNames(tx, ['Kubernetes'])),
      db.withTransaction((tx) => service.ensureByNames(tx, ['kubernetes'])),
    ]);
    expect(a).toEqual(b);
    const rows = await allTechnologies();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(a[0]);
  });

  it('rolls back the inserted technologies when the transaction fails', async () => {
    await expect(
      db.withTransaction(async (tx) => {
        await service.ensureByNames(tx, ['Rust']);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(await allTechnologies()).toEqual([]);
  });
});
