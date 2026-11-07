// Auth_Middleware, Role_Guard and GET /api/auth/me with a fake db and a controlled clock
// (Requirements 6.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8).
import { generateKeyPairSync } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAppConfig } from '../../src/config/env.js';
import { adminOnly, parseBearer, parseSubject, requireRole } from '../../src/middleware/auth.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { validate } from '../../src/middleware/validate.js';
import { SQL } from '../../src/services/authService.js';
import { createLogger } from '../../src/utils/logger.js';
import { createHasher } from '../../src/utils/password.js';
import { object, str } from '../../src/validators/rules.js';
import { idParams } from '../../src/validators/params.schemas.js';

const SECRET = 'unit-test-secret-that-is-at-least-32-chars';
const config = loadAppConfig({
  JWT_SECRET: SECRET,
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
});

/** Fixed "now" in whole seconds; the clock returns milliseconds. */
const NOW = 1_800_000_000;
const UNAUTHORIZED = { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };

/** Fake db with an `admins` table keyed by id; records every findById lookup. */
function fakeDb(admins = [{ id: 7, email: 'owner@example.com', role: 'admin' }]) {
  const rows = new Map(admins.map((a) => [a.id, { ...a }]));
  const lookups = [];
  return {
    rows,
    lookups,
    healthCheck: async () => true,
    query: async (text, params) => {
      expect(text).toBe(SQL.findById);
      lookups.push(params);
      const row = rows.get(params[0]);
      return { rows: row ? [{ ...row }] : [] };
    },
  };
}

function setup({ db = fakeDb(), now = NOW * 1000 } = {}) {
  const clock = { now: () => now };
  const lines = [];
  const push = (l) => lines.push(typeof l === 'string' ? l : JSON.stringify(l));
  const logger = createLogger({ sink: { info: push, warn: push, error: push } });
  const app = createApp({ config, db, clock, logger, hasher: createHasher({ cost: 4 }) });
  return { app, db, lines };
}

/** Signs a token the way the API_Server does, with iat/exp relative to NOW unless overridden. */
function token(claims = {}, { secret = SECRET, algorithm = 'HS256' } = {}) {
  return jwt.sign(
    { sub: '7', email: 'owner@example.com', role: 'admin', iat: NOW - 60, exp: NOW + 3600, ...claims },
    secret,
    { algorithm },
  );
}

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const me = (app, header) => {
  const req = request(app).get('/api/auth/me');
  return header === undefined ? req : req.set('Authorization', header);
};

describe('parseBearer', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc', 'abc'],
    ['BEARER abc', 'abc'],
  ])('accepts %j', (header, expected) => {
    expect(parseBearer(header)).toBe(expected);
  });

  it.each([undefined, '', 'Bearer', 'Bearer ', 'Bearer  abc', 'Bearer a b', 'Bearer abc ', ' Bearer abc', 'Basic abc', 'Token abc', 'Bearerabc'])(
    'rejects %j',
    (header) => {
      expect(parseBearer(header)).toBeNull();
    },
  );
});

describe('parseSubject', () => {
  it.each([
    ['1', 1],
    ['7', 7],
    ['2147483647', 2147483647],
  ])('accepts %j', (sub, id) => {
    expect(parseSubject(sub)).toBe(id);
  });

  it.each([undefined, 7, '', '0', '007', '-1', '+1', '1.0', '1e3', ' 1', 'abc', '2147483648', '99999999999'])(
    'rejects %j',
    (sub) => {
      expect(parseSubject(sub)).toBeNull();
    },
  );
});

describe('GET /api/auth/me', () => {
  it('returns 200 with the stored id, email and role only', async () => {
    const { app, db } = setup();
    const res = await me(app, `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 7, email: 'owner@example.com', role: 'admin' } });
    // One lookup by the Auth_Middleware and one by the handler, both by the token's id.
    expect(db.lookups).toEqual([[7], [7]]);
  });

  it('accepts a lowercase bearer scheme', async () => {
    const { app } = setup();
    expect((await me(app, `bearer ${token()}`)).status).toBe(200);
  });

  it('reports the email as currently stored, not the one in the token', async () => {
    const { app } = setup({ db: fakeDb([{ id: 7, email: 'new@example.com', role: 'admin' }]) });
    const res = await me(app, `Bearer ${token({ email: 'old@example.com' })}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('new@example.com');
  });

  it('accepts a token issued by POST /api/auth/login', async () => {
    const hasher = createHasher({ cost: 4 });
    const hash = await hasher.hash('correct-password');
    const row = { id: 7, email: 'owner@example.com', role: 'admin', password_hash: hash };
    const db = {
      healthCheck: async () => true,
      query: async (text, params) => {
        if (text === SQL.findByEmail) return { rows: params[0] === row.email ? [row] : [] };
        if (text === SQL.findById) return { rows: params[0] === row.id ? [row] : [] };
        throw new Error(`unexpected query ${text}`);
      },
    };
    const app = createApp({ config, db, hasher, logger: createLogger({ sink: { info() {}, warn() {}, error() {} } }) });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@example.com', password: 'correct-password' });
    const res = await me(app, `Bearer ${login.body.data.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 7, email: 'owner@example.com', role: 'admin' });
  });

  const rs256Key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const rejected = [
    ['no Authorization header', () => undefined],
    ['an empty Authorization header', () => ''],
    ['the Basic scheme', () => 'Basic dXNlcjpwYXNz'],
    ['a Token scheme with a valid JWT', () => `Token ${token()}`],
    ['Bearer with no token', () => 'Bearer'],
    ['Bearer with an empty token', () => 'Bearer '],
    ['Bearer with two parts', () => `Bearer ${token()} extra`],
    ['Bearer with a tampered signature', () => `Bearer ${token().slice(0, -2)}xx`],
    ['a token signed with another secret', () => `Bearer ${token({}, { secret: `${SECRET}-other` })}`],
    ['a malformed token', () => 'Bearer not-a-jwt'],
    ['a token with two segments', () => 'Bearer aaa.bbb'],
    ['an unsigned alg none token', () => `Bearer ${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: '7', role: 'admin', exp: NOW + 3600 })}.`],
    ['an HS512 token with the right secret', () => `Bearer ${token({}, { algorithm: 'HS512' })}`],
    ['an RS256 token', () => `Bearer ${jwt.sign({ sub: '7', role: 'admin', exp: NOW + 3600 }, rs256Key, { algorithm: 'RS256' })}`],
    ['an expired token', () => `Bearer ${token({ iat: NOW - 7200, exp: NOW - 1 })}`],
    ['a token whose exp equals now', () => `Bearer ${token({ exp: NOW })}`],
    ['a token without exp', () => `Bearer ${jwt.sign({ sub: '7', role: 'admin', iat: NOW }, SECRET)}`],
    ['a token without sub', () => `Bearer ${token({ sub: undefined })}`],
    ['a numeric sub', () => `Bearer ${jwt.sign({ sub: 7, role: 'admin', exp: NOW + 3600 }, SECRET)}`],
    ['a non-numeric sub', () => `Bearer ${token({ sub: 'abc' })}`],
    ['a zero sub', () => `Bearer ${token({ sub: '0' })}`],
    ['an out-of-range sub', () => `Bearer ${token({ sub: '2147483648' })}`],
    ['a token without role', () => `Bearer ${token({ role: undefined })}`],
    ['an empty role', () => `Bearer ${token({ role: '' })}`],
    ['a non-string role', () => `Bearer ${token({ role: ['admin'] })}`],
    ['a token for a deleted admin', () => `Bearer ${token({ sub: '8' })}`],
  ];

  it.each(rejected)('returns 401 for %s', async (_name, header) => {
    const { app } = setup();
    const value = header();
    const res = await me(app, value);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
    if (value) {
      const sent = value.split(' ').slice(1).join(' ');
      if (sent) expect(res.text).not.toContain(sent);
    }
  });

  it('only queries the Database after the token checks pass', async () => {
    const { app, db } = setup();
    await me(app, `Bearer ${token({ exp: NOW })}`);
    await me(app, 'Basic abc');
    expect(db.lookups).toEqual([]);
    await me(app, `Bearer ${token({ sub: '8' })}`);
    expect(db.lookups).toEqual([[8]]);
  });

  it('treats exp one second after now as valid and exp at now as expired', async () => {
    const t = token({ exp: NOW + 1 });
    expect((await me(setup({ now: NOW * 1000 }).app, `Bearer ${t}`)).status).toBe(200);
    expect((await me(setup({ now: NOW * 1000 + 999 }).app, `Bearer ${t}`)).status).toBe(200);
    expect((await me(setup({ now: (NOW + 1) * 1000 }).app, `Bearer ${t}`)).status).toBe(401);
  });

  it('returns 401 when the admin is deleted after the token was issued', async () => {
    const { app, db } = setup();
    const t = token();
    expect((await me(app, `Bearer ${t}`)).status).toBe(200);
    db.rows.delete(7);
    const res = await me(app, `Bearer ${t}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('returns 403 FORBIDDEN for a valid token with a role other than admin', async () => {
    const { app } = setup();
    const res = await me(app, `Bearer ${token({ role: 'editor' })}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' },
    });
    expect(res.text).not.toContain('owner@example.com');
  });

  it('returns 401, not 403, for a non-admin role whose admin row is missing', async () => {
    const { app } = setup();
    expect((await me(app, `Bearer ${token({ sub: '8', role: 'editor' })}`)).status).toBe(401);
  });

  it('passes a Database error to the Error_Handler as a generic 500, not a 401', async () => {
    const db = {
      healthCheck: async () => true,
      query: async () => {
        throw new Error('relation "admins" does not exist');
      },
    };
    const { app, lines } = setup({ db });
    const t = token();
    const res = await me(app, `Bearer ${t}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.text).not.toContain('admins');
    expect(lines.join('\n')).not.toContain(t);
  });

  it('writes no token to the log', async () => {
    const { app, lines } = setup();
    const good = token();
    const bad = token({}, { secret: `${SECRET}-other` });
    await me(app, `Bearer ${good}`);
    await me(app, `Bearer ${bad}`);
    const log = lines.join('\n');
    expect(log).not.toContain(good);
    expect(log).not.toContain(bad);
  });
});

describe('requireRole', () => {
  const run = (auth) => {
    let passed;
    requireRole('admin')({ auth }, {}, (err) => {
      passed = err;
    });
    return passed;
  };

  it('passes an admin through', () => {
    expect(run({ id: 1, email: 'a@example.com', role: 'admin' })).toBeUndefined();
  });

  it.each(['editor', 'Admin', 'admin ', ''])('rejects role %j with 403 FORBIDDEN', (role) => {
    const err = run({ id: 1, email: 'a@example.com', role });
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('fails closed with 401 when the Auth_Middleware did not run', () => {
    expect(run(undefined).status).toBe(401);
  });
});

describe('admin protection runs before validation (7.8)', () => {
  // A test-only router built the way resource routers use `requireAdmin`.
  function protectedApp(db = fakeDb()) {
    const requireAdmin = adminOnly({ db, config, clock: { now: () => NOW * 1000 } });
    const writes = [];
    const app = express();
    app.use(express.json());
    app.put(
      '/things/:id',
      ...requireAdmin,
      validate({ params: idParams, body: object({ name: str({ min: 1, max: 10 }) }) }),
      (req, res) => {
        writes.push({ auth: req.auth, valid: req.valid });
        res.json({ success: true, data: req.valid.body });
      },
    );
    app.use(createErrorHandler({ logger: { info() {}, warn() {}, error() {} } }));
    return { app, writes };
  }

  it('returns 401 for a bad id and an invalid body when no token is sent', async () => {
    const { app, writes } = protectedApp();
    const res = await request(app).put('/things/abc').send({ nope: true });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(writes).toEqual([]);
  });

  it('returns 403 for a bad id when the role is not admin', async () => {
    const { app, writes } = protectedApp();
    const res = await request(app).put('/things/abc').set('Authorization', `Bearer ${token({ role: 'editor' })}`);
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
  });

  it('validates only after authentication passes', async () => {
    const { app } = protectedApp();
    const auth = `Bearer ${token()}`;
    expect((await request(app).put('/things/abc').set('Authorization', auth).send({ name: 'x' })).body.error.code).toBe(
      'INVALID_ID',
    );
    expect((await request(app).put('/things/1').set('Authorization', auth).send({})).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('attaches the database id and email and the token role to req.auth', async () => {
    const { app, writes } = protectedApp(fakeDb([{ id: 7, email: 'stored@example.com', role: 'admin' }]));
    const res = await request(app)
      .put('/things/3')
      .set('Authorization', `Bearer ${token({ email: 'token@example.com' })}`)
      .send({ name: 'x' });
    expect(res.status).toBe(200);
    expect(writes).toEqual([{ auth: { id: 7, email: 'stored@example.com', role: 'admin' }, valid: { params: { id: 3 }, body: { name: 'x' } } }]);
  });
});
