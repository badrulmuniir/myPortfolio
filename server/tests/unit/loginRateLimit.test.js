// Login Rate_Limiter through createApp, with a fake db, a cost-4 hasher and a fake clock
// (Requirements 8.1, 8.3, 8.5, 8.6, 8.7, 9.3).
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAppConfig } from '../../src/config/env.js';
import { SQL } from '../../src/services/authService.js';
import { createLogger } from '../../src/utils/logger.js';
import { createHasher } from '../../src/utils/password.js';
import { createLoginLimiter } from '../../src/utils/rateLimiter.js';

const PASSWORD = 'correct-password-123';
const EMAIL = 'owner@example.com';
const baseEnv = {
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/portfolio',
};

const hasher = createHasher({ cost: 4 });
let storedHash;
beforeAll(async () => {
  storedHash = await hasher.hash(PASSWORD);
});

function fakeDb() {
  const lookups = [];
  return {
    lookups,
    healthCheck: async () => true,
    query: async (text, params) => {
      expect(text).toBe(SQL.findByEmail);
      lookups.push(params);
      const row = { id: 1, email: EMAIL, role: 'admin', password_hash: storedHash };
      return { rows: params[0] === EMAIL ? [row] : [] };
    },
  };
}

const silentLogger = createLogger({ sink: { info() {}, warn() {}, error() {} } });

function setup({ trustProxy = false } = {}) {
  const clock = { t: Date.UTC(2024, 0, 1), now() { return this.t; } };
  const config = loadAppConfig({ ...baseEnv, TRUST_PROXY: String(trustProxy) });
  const db = fakeDb();
  const loginLimiter = createLoginLimiter({ clock, sweepIntervalMs: 0 });
  const app = createApp({ config, db, clock, hasher, logger: silentLogger, loginLimiter });
  return { app, clock, db, loginLimiter };
}

const wrong = { email: EMAIL, password: 'wrong-password' };
const right = { email: EMAIL, password: PASSWORD };
const login = (app, body, xff) => {
  const req = request(app).post('/api/auth/login');
  if (xff !== undefined) req.set('X-Forwarded-For', xff);
  return req.send(body);
};

async function failTimes(app, n, xff) {
  for (let i = 0; i < n; i += 1) {
    const res = await login(app, wrong, xff);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  }
}

const tooMany = {
  success: false,
  error: { code: 'TOO_MANY_LOGIN_ATTEMPTS', message: 'Too many login attempts. Please try again later.' },
};

describe('login Rate_Limiter', () => {
  it('answers 5 failures with 401 and the 6th request with 429, Retry-After and an Error_Response', async () => {
    const { app } = setup();
    await failTimes(app, 5);
    const res = await login(app, wrong);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('900');
    expect(res.body).toEqual(tooMany);
    // Security headers still apply to the 429.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects correct credentials while blocked, without looking them up', async () => {
    const { app, db } = setup();
    await failTimes(app, 5);
    const before = db.lookups.length;
    const res = await login(app, right);
    expect(res.status).toBe(429);
    expect(res.body.data).toBeUndefined();
    expect(db.lookups.length).toBe(before);
  });

  it('rejects a blocked request before validation', async () => {
    const { app } = setup();
    await failTimes(app, 5);
    const res = await login(app, { email: 'not-an-email' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_LOGIN_ATTEMPTS');
  });

  it('does not count validation errors', async () => {
    const { app } = setup();
    for (let i = 0; i < 10; i += 1) {
      expect((await login(app, { email: 'bad' })).status).toBe(400);
    }
    await failTimes(app, 5);
    expect((await login(app, wrong)).status).toBe(429);
  });

  it('does not count or reset on a successful login', async () => {
    const { app } = setup();
    await failTimes(app, 4);
    expect((await login(app, right)).status).toBe(200);
    expect((await login(app, right)).status).toBe(200);
    await failTimes(app, 1);
    expect((await login(app, right)).status).toBe(429);
  });

  it('does not count 429 responses', async () => {
    const { app, clock } = setup();
    await failTimes(app, 5);
    for (let i = 0; i < 3; i += 1) expect((await login(app, wrong)).status).toBe(429);
    clock.t += 15 * 60 * 1000;
    // A new window: 4 more failures are still answered with 401, the 5th too.
    await failTimes(app, 5);
    expect((await login(app, wrong)).status).toBe(429);
  });

  it('sends Retry-After with the remaining seconds rounded up, between 1 and 900', async () => {
    const { app, clock } = setup();
    const start = clock.t;
    await failTimes(app, 5);
    const cases = [
      [1, '900'],
      [1_000, '899'],
      [450_500, '450'],
      [899_001, '1'],
      [899_999, '1'],
    ];
    for (const [elapsed, expected] of cases) {
      clock.t = start + elapsed;
      const res = await login(app, right);
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBe(expected);
    }
  });

  it('unblocks when the 15-minute window ends', async () => {
    const { app, clock } = setup();
    const start = clock.t;
    await failTimes(app, 5);
    clock.t = start + 15 * 60 * 1000 - 1;
    expect((await login(app, right)).status).toBe(429);
    clock.t = start + 15 * 60 * 1000;
    expect((await login(app, right)).status).toBe(200);
  });

  it('gives each app its own limiter by default', async () => {
    const config = loadAppConfig(baseEnv);
    const a = createApp({ config, db: fakeDb(), hasher, logger: silentLogger });
    const b = createApp({ config, db: fakeDb(), hasher, logger: silentLogger });
    await failTimes(a, 5);
    expect((await login(a, wrong)).status).toBe(429);
    expect((await login(b, wrong)).status).toBe(401);
  });

  it('does not count requests to other endpoints', async () => {
    const { app } = setup();
    for (let i = 0; i < 6; i += 1) {
      expect((await request(app).get('/api/auth/me')).status).toBe(401);
    }
    await failTimes(app, 5);
  });

  describe('client identification', () => {
    it('with TRUST_PROXY=false, ignores X-Forwarded-For and keys on the socket address', async () => {
      const { app, loginLimiter } = setup({ trustProxy: false });
      for (let i = 0; i < 5; i += 1) {
        expect((await login(app, wrong, `203.0.113.${i + 1}`)).status).toBe(401);
      }
      const res = await login(app, wrong, '198.51.100.99');
      expect(res.status).toBe(429);
      expect(loginLimiter.size).toBe(1);
      expect(app.get('trust proxy')).toBe(false);
    });

    it('with TRUST_PROXY=true, keys on the client address from one proxy hop', async () => {
      const { app, loginLimiter } = setup({ trustProxy: true });
      await failTimes(app, 5, '203.0.113.1');
      expect((await login(app, wrong, '203.0.113.1')).status).toBe(429);
      // A different forwarded client is counted separately.
      expect((await login(app, wrong, '203.0.113.2')).status).toBe(401);
      // Only the hop added by the trusted proxy counts; a spoofed left-most entry is ignored.
      expect((await login(app, right, '203.0.113.2, 203.0.113.1')).status).toBe(429);
      expect(loginLimiter.size).toBe(2);
      expect(app.get('trust proxy')).toBe(1);
    });
  });
});
