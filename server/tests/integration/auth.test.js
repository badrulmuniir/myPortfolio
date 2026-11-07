// POST /api/auth/login against the PostgreSQL test database (Requirements 5.1, 5.3).
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAppConfig } from '../../src/config/env.js';
import { createHasher } from '../../src/utils/password.js';
import { TEST_ADMIN_PASSWORD, createAdmin } from '../helpers/factories.js';
import { closeTestDb, getTestDb, resetDb } from '../helpers/testDb.js';

const SECRET = 'integration-test-secret-at-least-32-chars';
const config = loadAppConfig({
  JWT_SECRET: SECRET,
  FRONTEND_URL: 'http://localhost:5173',
  // Only used by the config loader; the app uses the injected test db.
  DATABASE_URL: 'postgres://unused@localhost:5432/unused',
});
const db = getTestDb();
const app = createApp({ config, db, hasher: createHasher({ cost: 4 }) });

beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

describe('POST /api/auth/login against the test database', () => {
  it('signs in with the stored bcrypt hash and a mixed-case email', async () => {
    const admin = await createAdmin(db, { email: 'owner@example.com' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ' Owner@Example.com ', password: TEST_ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.admin).toEqual({ id: admin.id, email: 'owner@example.com', role: 'admin' });
    expect(res.text).not.toContain('password_hash');
    const claims = jwt.verify(res.body.data.token, SECRET, { algorithms: ['HS256'] });
    expect(claims).toMatchObject({ sub: String(admin.id), email: 'owner@example.com', role: 'admin' });
    expect(claims.exp - claims.iat).toBe(7200);
  });

  it('returns the same 401 for a wrong password and an unknown email', async () => {
    await createAdmin(db, { email: 'owner@example.com' });
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@example.com', password: `${TEST_ADMIN_PASSWORD}x` });
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: TEST_ADMIN_PASSWORD });

    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
    }
  });
});

describe('GET /api/auth/me against the test database', () => {
  async function signIn() {
    const admin = await createAdmin(db, { email: 'owner@example.com' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@example.com', password: TEST_ADMIN_PASSWORD });
    return { admin, token: res.body.data.token };
  }

  it('returns the signed-in admin as stored', async () => {
    const { admin, token } = await signIn();
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: admin.id, email: 'owner@example.com', role: 'admin' } });
  });

  it('returns 401 without a token', async () => {
    await signIn();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 once the admin row is deleted', async () => {
    const { admin, token } = await signIn();
    await db.query('DELETE FROM admins WHERE id = $1', [admin.id]);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  });
});
