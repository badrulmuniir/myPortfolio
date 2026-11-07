// Technology service and endpoint with a fake db (Requirements 14.1, 14.2, 14.3, 7.1).
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { adminOnly } from '../../src/middleware/auth.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createTechnologyRouter } from '../../src/routes/technology.routes.js';
import {
  SQL,
  createTechnologyService,
  ensureTechnologiesByNames,
  ensureTechnologyRows,
  uniqueNames,
} from '../../src/services/technologyService.js';

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

/**
 * Fake db/tx backed by an array of technologies. It models the three statements of the service:
 * the unique index on lower(name) and the ordered join on the submitted names.
 */
function fakeDb(technologies = []) {
  const rows = technologies.map((t) => ({ category: '', ...t }));
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;
  const calls = [];
  const find = (name) => rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
  return {
    rows,
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      if (text === SQL.list) return { rows: rows.map((r) => ({ ...r })) };
      if (text === SQL.insertMissing) {
        for (const name of params[0]) if (!find(name)) rows.push({ id: nextId++, name, category: '' });
        return { rows: [] };
      }
      if (text === SQL.selectByNames) {
        return { rows: params[0].map(find).filter(Boolean).map((r) => ({ ...r })) };
      }
      throw new Error(`unexpected query ${text}`);
    },
  };
}

function setup({ db = fakeDb(), requireAdmin = stubAdmin } = {}) {
  const app = express();
  app.use(jsonBody);
  app.use('/api', createTechnologyRouter({ db, config, requireAdmin }));
  app.use(createErrorHandler({ logger: silent }));
  return { app, db };
}

describe('GET /api/technologies', () => {
  it('orders by lower(name) in code-point order, then id', () => {
    const order = SQL.list.replace(/\s+/g, ' ').split('ORDER BY ')[1];
    expect(order).toBe('lower(name) COLLATE "C" ASC, id ASC');
  });

  it('returns id, name and category for every technology in the order received', async () => {
    const technologies = [
      { id: 2, name: 'Node.js', category: '' },
      { id: 1, name: 'React', category: 'Frontend' },
    ];
    const { app } = setup({ db: fakeDb(technologies) });
    const res = await request(app).get('/api/technologies');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: technologies });
  });

  it('returns an empty list when no technology exists', async () => {
    const res = await request(setup().app).get('/api/technologies');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('returns 401 without a token when the real Auth_Middleware is used', async () => {
    const db = fakeDb([{ id: 1, name: 'React' }]);
    const { app } = setup({ db, requireAdmin: adminOnly({ db, config }) });
    const res = await request(app).get('/api/technologies');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(db.calls).toEqual([]);
  });

  it('passes a database failure to the Error_Handler as a generic 500', async () => {
    const db = { query: async () => { throw new Error('relation "technologies" does not exist'); } };
    const res = await request(setup({ db }).app).get('/api/technologies');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('relation');
  });
});

describe('uniqueNames', () => {
  it('trims, drops empty values and keeps the first spelling of each case-insensitive name', () => {
    expect(uniqueNames([' React ', 'react', '', '  ', 'Node.js', 'REACT', 'node.JS', 'Vite'])).toEqual([
      'React',
      'Node.js',
      'Vite',
    ]);
  });
});

describe('ensureByNames', () => {
  it('sends no query for an empty list', async () => {
    const tx = fakeDb([{ id: 1, name: 'React' }]);
    expect(await ensureTechnologiesByNames(tx, [])).toEqual([]);
    expect(tx.calls).toEqual([]);
  });

  it('runs one insert and one select with the same names', async () => {
    const tx = fakeDb();
    await ensureTechnologiesByNames(tx, ['React', 'Vite']);
    expect(tx.calls).toEqual([
      { text: SQL.insertMissing, params: [['React', 'Vite']] },
      { text: SQL.selectByNames, params: [['React', 'Vite']] },
    ]);
  });

  it('inserts with ON CONFLICT on lower(name) so existing names are left alone', () => {
    expect(SQL.insertMissing).toBe(
      'INSERT INTO technologies (name) SELECT unnest($1::text[]) ON CONFLICT ((lower(name))) DO NOTHING',
    );
  });

  it('returns ids in the order of the submitted names', async () => {
    const tx = fakeDb([
      { id: 1, name: 'React' },
      { id: 2, name: 'Node.js' },
    ]);
    expect(await ensureTechnologiesByNames(tx, ['Vite', 'Node.js', 'PostgreSQL', 'React'])).toEqual([3, 2, 4, 1]);
  });

  it('matches existing technologies case-insensitively and keeps their stored name and category (14.1)', async () => {
    const tx = fakeDb([{ id: 7, name: 'React', category: 'Frontend' }]);
    const rows = await ensureTechnologyRows(tx, ['react']);
    expect(rows).toEqual([{ id: 7, name: 'React', category: 'Frontend' }]);
    expect(tx.rows).toEqual([{ id: 7, name: 'React', category: 'Frontend' }]);
  });

  it('creates unknown names in their submitted case with an empty category (14.2)', async () => {
    const tx = fakeDb();
    const rows = await ensureTechnologyRows(tx, ['TypeScript']);
    expect(rows).toEqual([{ id: 1, name: 'TypeScript', category: '' }]);
  });

  it('dedupes names case-insensitively before querying', async () => {
    const tx = fakeDb();
    const ids = await ensureTechnologiesByNames(tx, ['Vite', ' vite ', 'VITE', 'React']);
    expect(ids).toEqual([1, 2]);
    expect(tx.calls[0].params).toEqual([['Vite', 'React']]);
    expect(tx.rows.map((r) => r.name)).toEqual(['Vite', 'React']);
  });

  it('never returns the same id twice', async () => {
    // A tx whose select maps two names to the same row, as lower() could for exotic characters.
    const tx = {
      async query(text) {
        if (text === SQL.selectByNames) return { rows: [{ id: 5, name: 'A', category: '' }, { id: 5, name: 'A', category: '' }] };
        return { rows: [] };
      },
    };
    expect(await ensureTechnologiesByNames(tx, ['A', 'B'])).toEqual([5]);
  });

  it('is exposed on the service as ensureByNames and ensureRowsByNames', async () => {
    const service = createTechnologyService({ db: fakeDb() });
    const tx = fakeDb([{ id: 1, name: 'React' }]);
    expect(await service.ensureByNames(tx, ['react', 'Go'])).toEqual([1, 2]);
    expect(await service.ensureRowsByNames(tx, ['GO'])).toEqual([{ id: 2, name: 'Go', category: '' }]);
  });
});
