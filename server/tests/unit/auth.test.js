// POST /api/auth/login with a fake db and a cost-4 hasher (Requirements 5.1–5.8, 5.10).
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAppConfig } from '../../src/config/env.js';
import { SQL, createAuthService } from '../../src/services/authService.js';
import { createLogger } from '../../src/utils/logger.js';
import { createHasher } from '../../src/utils/password.js';

const SECRET = 'unit-test-secret-that-is-at-least-32-chars';
const PASSWORD = '  Correct Horse Battery  ';
const config = loadAppConfig({
  JWT_SECRET: SECRET,
  JWT_EXPIRES_IN: '45m',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});

const baseHasher = createHasher({ cost: 4 });
let storedHash;
beforeAll(async () => {
  storedHash = await baseHasher.hash(PASSWORD);
});

/** Hasher that records every compare call (password, hash). */
function spyHasher() {
  const compares = [];
  return {
    compares,
    hasher: {
      cost: baseHasher.cost,
      hash: (p) => baseHasher.hash(p),
      compare: async (p, h) => {
        compares.push({ password: p, hash: h });
        return baseHasher.compare(p, h);
      },
    },
  };
}

/** Fake db holding one admin row; records the parameters of every admins lookup. */
function fakeDb() {
  const lookups = [];
  const row = { id: 7, email: 'owner@example.com', role: 'admin', password_hash: storedHash };
  return {
    lookups,
    healthCheck: async () => true,
    query: async (text, params) => {
      expect(text).toBe(SQL.findByEmail);
      lookups.push(params);
      return { rows: params[0] === row.email ? [row] : [] };
    },
  };
}

function setup() {
  const db = fakeDb();
  const { hasher, compares } = spyHasher();
  const lines = [];
  const push = (l) => lines.push(typeof l === 'string' ? l : JSON.stringify(l));
  const logger = createLogger({ sink: { info: push, warn: push, error: push } });
  const app = createApp({ config, db, hasher, logger });
  return { app, db, compares, lines };
}

const login = (app, body) => request(app).post('/api/auth/login').send(body);

describe('POST /api/auth/login', () => {
  it('returns 200 with a token and the admin id, email and role only', async () => {
    const { app } = setup();
    const res = await login(app, { email: 'owner@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body.data).sort()).toEqual(['admin', 'token']);
    expect(res.body.data.admin).toEqual({ id: 7, email: 'owner@example.com', role: 'admin' });
    expect(res.text).not.toContain('password_hash');
    expect(res.text).not.toContain(storedHash);
    expect(res.text).not.toContain(PASSWORD);
  });

  it('signs an HS256 JWT with sub, email, role and the configured lifetime', async () => {
    const { app } = setup();
    const res = await login(app, { email: 'owner@example.com', password: PASSWORD });
    const { token } = res.body.data;
    expect(jwt.decode(token, { complete: true }).header.alg).toBe('HS256');
    const claims = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    expect(claims).toMatchObject({ sub: '7', email: 'owner@example.com', role: 'admin' });
    expect(claims.exp - claims.iat).toBe(45 * 60);
    expect(() => jwt.verify(token, `${SECRET}-other`, { algorithms: ['HS256'] })).toThrow();
  });

  it('uses a 2-hour lifetime when JWT_EXPIRES_IN is not set', async () => {
    const db = fakeDb();
    const defaults = loadAppConfig({
      JWT_SECRET: SECRET,
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
    });
    const service = createAuthService({ db, config: defaults, hasher: baseHasher });
    const { token } = await service.login('owner@example.com', PASSWORD);
    const claims = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    expect(claims.exp - claims.iat).toBe(7200);
  });

  it('matches the email after trimming and lowercasing', async () => {
    const { app, db } = setup();
    const res = await login(app, { email: '  OWNER@Example.COM ', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(db.lookups).toEqual([['owner@example.com']]);
  });

  it('compares the password exactly as received, without trimming or changing case', async () => {
    const { app, compares } = setup();
    for (const variant of [PASSWORD.trim(), PASSWORD.toUpperCase(), `${PASSWORD} `]) {
      const res = await login(app, { email: 'owner@example.com', password: variant });
      expect(res.status).toBe(401);
    }
    expect(compares.map((c) => c.password)).toEqual([PASSWORD.trim(), PASSWORD.toUpperCase(), `${PASSWORD} `]);
  });

  it('returns the same 401 for an unknown email and a wrong password, and still compares', async () => {
    const { app, compares } = setup();
    const unknown = await login(app, { email: 'nobody@example.com', password: PASSWORD });
    const wrong = await login(app, { email: 'owner@example.com', password: 'wrong-password' });

    const expected = {
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
    };
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(expected);
    expect(wrong.body).toEqual(expected);
    expect(unknown.text).not.toContain('token');

    // One bcrypt comparison per request; the unknown email is compared against a dummy hash
    // with the same cost as the injected hasher.
    expect(compares).toHaveLength(2);
    expect(compares[0].hash).not.toBe(storedHash);
    expect(compares[0].hash).toMatch(/^\$2[aby]\$04\$/);
    expect(compares[1].hash).toBe(storedHash);
  });

  it('creates the dummy hash once and reuses it', async () => {
    const { app, compares } = setup();
    await login(app, { email: 'a@example.com', password: 'x' });
    await login(app, { email: 'b@example.com', password: 'y' });
    expect(compares[0].hash).toBe(compares[1].hash);
  });

  it.each([
    ['missing email', { password: PASSWORD }, ['email']],
    ['missing password', { email: 'owner@example.com' }, ['password']],
    ['missing both', {}, ['email', 'password']],
    ['non-string email', { email: 42, password: PASSWORD }, ['email']],
    ['non-string password', { email: 'owner@example.com', password: ['a'] }, ['password']],
    ['invalid email', { email: 'not-an-email', password: PASSWORD }, ['email']],
    ['empty password', { email: 'owner@example.com', password: '' }, ['password']],
    ['73-byte password', { email: 'owner@example.com', password: 'a'.repeat(73) }, ['password']],
    ['unknown key', { email: 'owner@example.com', password: PASSWORD, extra: 1 }, ['extra']],
  ])('returns 400 with details for %s and issues no token', async (_name, body, fields) => {
    const { app, compares, db } = setup();
    const res = await login(app, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(fields);
    expect(res.body.data).toBeUndefined();
    expect(compares).toHaveLength(0);
    expect(db.lookups).toHaveLength(0);
  });

  it('accepts a password of exactly 72 bytes', async () => {
    const { app } = setup();
    const res = await login(app, { email: 'owner@example.com', password: 'é'.repeat(36) });
    expect(res.status).toBe(401);
  });

  it.each(['Bearer garbage', 'Bearer ', 'Basic dXNlcjpwYXNz', 'nonsense'])(
    'ignores the Authorization header %j',
    async (header) => {
      const { app } = setup();
      const res = await request(app)
        .post('/api/auth/login')
        .set('Authorization', header)
        .send({ email: 'owner@example.com', password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.data.admin.id).toBe(7);
    },
  );

  it('writes neither the password nor the token to the log', async () => {
    const { app, lines } = setup();
    const ok = await login(app, { email: 'owner@example.com', password: PASSWORD });
    await login(app, { email: 'owner@example.com', password: 'wrong-password' });
    const log = lines.join('\n');
    expect(log).not.toContain(PASSWORD);
    expect(log).not.toContain('wrong-password');
    expect(log).not.toContain(ok.body.data.token);
  });
});
