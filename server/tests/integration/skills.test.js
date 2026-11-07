// Skill endpoints against the PostgreSQL test database (Requirements 15.1, 15.2, 15.7, 15.8).
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../src/config/env.js';
import { jsonBody } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createSkillRouter } from '../../src/routes/skill.routes.js';
import { createSkill } from '../helpers/factories.js';
import { closeTestDb, getTestDb, resetDb, snapshot } from '../helpers/testDb.js';

const config = loadAppConfig({
  JWT_SECRET: 'integration-test-secret-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  // Only used by the config loader; the router uses the injected test db.
  DATABASE_URL: 'postgres://unused@localhost:5432/unused',
});
const db = getTestDb();

// Admin protection is covered by the auth tests; here it is replaced by a stub.
const requireAdmin = [
  (req, res, next) => {
    req.auth = { id: 1, email: 'owner@example.com', role: 'admin' };
    next();
  },
];
const app = express();
app.use(jsonBody);
app.use('/api', createSkillRouter({ db, config, requireAdmin }));
app.use(createErrorHandler({ logger: { info() {}, warn() {}, error() {} } }));

beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

const pick = ({ id, name, category, proficiency_level, icon_url, display_order }) => ({
  id,
  name,
  category,
  proficiency_level,
  icon_url,
  display_order,
});

describe('skill CRUD against the test database', () => {
  it('creates, reads, updates and deletes a skill', async () => {
    const created = await request(app)
      .post('/api/skills')
      .send({ name: ' TypeScript ', category: ' Programming Languages ', proficiency_level: 'Expert', icon_url: 'https://example.com/ts.svg', display_order: 2 });
    expect(created.status).toBe(201);
    const { id } = created.body.data;
    expect(Number.isInteger(id)).toBe(true);
    expect(created.body.data).toEqual({
      id,
      name: 'TypeScript',
      category: 'Programming Languages',
      proficiency_level: 'Expert',
      icon_url: 'https://example.com/ts.svg',
      display_order: 2,
    });

    expect((await request(app).get('/api/skills')).body.data).toEqual([created.body.data]);

    // PUT replaces every field; omitted optional fields become empty (15.7).
    const updated = await request(app).put(`/api/skills/${id}`).send({ name: 'JavaScript', category: 'Programming Languages', display_order: 0 });
    expect(updated.status).toBe(200);
    const expected = { id, name: 'JavaScript', category: 'Programming Languages', proficiency_level: '', icon_url: '', display_order: 0 };
    expect(updated.body.data).toEqual(expected);
    expect((await request(app).get('/api/skills')).body.data).toEqual([expected]);

    const deleted = await request(app).delete(`/api/skills/${id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toEqual({ id });
    expect((await request(app).get('/api/skills')).body.data).toEqual([]);
  });

  it('returns 404 for PUT and DELETE on an unknown id and changes nothing', async () => {
    await createSkill(db);
    const before = await snapshot(db, ['skills']);
    const put = await request(app).put('/api/skills/999').send({ name: 'X', category: 'Y', display_order: 0 });
    const del = await request(app).delete('/api/skills/999');
    expect(put.status).toBe(404);
    expect(del.status).toBe(404);
    expect(await snapshot(db, ['skills'])).toEqual(before);
  });

  it('returns 400 for an invalid body and changes nothing', async () => {
    const skill = await createSkill(db);
    const before = await snapshot(db, ['skills']);
    const post = await request(app).post('/api/skills').send({ name: 'X', category: 'Y', display_order: '3' });
    const put = await request(app).put(`/api/skills/${skill.id}`).send({ name: 'X', category: 'Y', display_order: 1, proficiency_level: 'Guru' });
    expect(post.status).toBe(400);
    expect(put.status).toBe(400);
    expect(await snapshot(db, ['skills'])).toEqual(before);
  });

  it('lists every skill once, ordered by category and name case-insensitively, then display_order and id', async () => {
    const specs = [
      { name: 'react', category: 'frontend', display_order: 1 },
      { name: 'Vue', category: 'Frontend', display_order: 0 },
      { name: 'Angular', category: 'FRONTEND', display_order: 1 },
      { name: 'b', category: 'Database', display_order: 5 },
      { name: 'A', category: 'database', display_order: 5 },
      { name: 'a', category: 'Database', display_order: 5 },
      { name: 'Git', category: 'Backend', display_order: 9 },
      { name: 'Zod', category: 'backend', display_order: 2 },
    ];
    const rows = [];
    for (const spec of specs) rows.push(pick(await createSkill(db, spec)));

    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const expected = [...rows].sort(
      (a, b) =>
        cmp(a.category.toLowerCase(), b.category.toLowerCase()) ||
        a.display_order - b.display_order ||
        cmp(a.name.toLowerCase(), b.name.toLowerCase()) ||
        a.id - b.id,
    );

    const res = await request(app).get('/api/skills');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expected);
    expect(res.body.data.map((s) => s.name)).toEqual(['Zod', 'Git', 'A', 'a', 'b', 'Vue', 'Angular', 'react']);
  });
});
