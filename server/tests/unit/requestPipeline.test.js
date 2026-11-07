// Task 5.3: security headers, body size guard and JSON parsing (Requirements 4.5, 4.6, 4.12, 9.5, 9.10).
import http from 'node:http';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAppConfig } from '../../src/config/env.js';
import { bodySizeGuard, declaredLength, jsonBody, MAX_BODY_BYTES } from '../../src/middleware/bodySizeGuard.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { securityHeaders } from '../../src/middleware/securityHeaders.js';
import { PayloadTooLargeError } from '../../src/utils/errors.js';

const config = loadAppConfig({
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/portfolio',
});

const fakeDb = (healthy) => ({ healthCheck: async () => healthy, query: async () => ({ rows: [] }) });
const silentLogger = { info() {}, warn() {}, error() {} };
const app = createApp({ config, db: fakeDb(true), logger: silentLogger });

/** A valid JSON object whose UTF-8 encoding is exactly `bytes` long. `{"a":""}` is 8 bytes. */
function jsonOfBytes(bytes) {
  const text = JSON.stringify({ a: 'x'.repeat(bytes - 8) });
  expect(Buffer.byteLength(text)).toBe(bytes);
  return text;
}

/** Malformed JSON of exactly `bytes` bytes. */
function malformedOfBytes(bytes) {
  return '{' + 'x'.repeat(bytes - 1);
}

/** Sends `body` with Transfer-Encoding: chunked (no Content-Length) in 8 KB chunks. */
function sendChunked(server, path, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(text) }));
      },
    );
    req.on('error', reject);
    for (let i = 0; i < body.length; i += 8192) req.write(body.slice(i, i + 8192));
    req.end();
  });
}

function expectSecurityHeaders(res) {
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-frame-options']).toBe('DENY');
  expect(res.headers['referrer-policy']).toBe('no-referrer');
  expect(res.headers['x-powered-by']).toBeUndefined();
}

const TOO_LARGE = { success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 100 KB' } };
const MALFORMED = { success: false, error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' } };

describe('securityHeaders', () => {
  it.each([
    ['200 health', () => request(app).get('/api/health'), 200],
    ['503 health', () => request(createApp({ config, db: fakeDb(false), logger: silentLogger })).get('/api/health'), 503],
    ['404 unknown /api route', () => request(app).get('/api/nope'), 404],
    ['404 outside /api', () => request(app).get('/nope'), 404],
    [
      'allowed-origin preflight',
      () => request(app).options('/api/health').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'PUT'),
      204,
    ],
    [
      'disallowed-origin preflight',
      () => request(app).options('/api/health').set('Origin', 'http://evil.example.com').set('Access-Control-Request-Method', 'PUT'),
      204,
    ],
    ['413', () => request(app).post('/api/x').set('Content-Type', 'application/json').send(jsonOfBytes(MAX_BODY_BYTES + 1)), 413],
    ['400 malformed JSON', () => request(app).post('/api/x').set('Content-Type', 'application/json').send('{bad'), 400],
  ])('are set on the %s response', async (_name, send, status) => {
    const res = await send();
    expect(res.status).toBe(status);
    expectSecurityHeaders(res);
  });

  it('keeps the preflight allow headers for a matching origin', async () => {
    const res = await request(app)
      .options('/api/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'PUT');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});

describe('declaredLength', () => {
  const req = (value) => ({ headers: value === undefined ? {} : { 'content-length': value } });
  it.each([
    [undefined, undefined],
    ['0', 0],
    ['102400', 102400],
    ['102401', 102401],
    ['+5', undefined],
    [' 5', undefined],
    ['1.5', undefined],
    ['', undefined],
  ])('parses %j as %j', (value, expected) => {
    expect(declaredLength(req(value))).toBe(expected);
  });
});

describe('bodySizeGuard', () => {
  const run = (headers) => {
    let arg = 'not called';
    bodySizeGuard({ headers }, {}, (err) => (arg = err));
    return arg;
  };
  it('passes 102,400 bytes and requests without Content-Length', () => {
    expect(run({ 'content-length': '102400' })).toBeUndefined();
    expect(run({})).toBeUndefined();
  });
  it('rejects 102,401 bytes with PayloadTooLargeError', () => {
    expect(run({ 'content-length': '102401' })).toBeInstanceOf(PayloadTooLargeError);
    expect(run({ 'content-length': '99999999999999999999999' })).toBeInstanceOf(PayloadTooLargeError);
  });
});

describe('body size and JSON parsing through createApp', () => {
  it('accepts exactly 102,400 bytes (request reaches the router: 404 ROUTE_NOT_FOUND)', async () => {
    const res = await request(app).post('/api/x').set('Content-Type', 'application/json').send(jsonOfBytes(MAX_BODY_BYTES));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('rejects 102,401 bytes with Content-Length → 413', async () => {
    const res = await request(app).post('/api/x').set('Content-Type', 'application/json').send(jsonOfBytes(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(res.body).toEqual(TOO_LARGE);
  });

  it('rejects an oversized declared length before reading any body', async () => {
    // A 102,401-byte non-JSON body would not be read by express.json, so only the guard can reject it.
    const res = await request(app).post('/api/x').set('Content-Type', 'text/plain').send('x'.repeat(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(res.body).toEqual(TOO_LARGE);
  });

  it('returns 400 MALFORMED_JSON for an unparseable body', async () => {
    const res = await request(app).post('/api/x').set('Content-Type', 'application/json').send('{"a": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual(MALFORMED);
  });

  it('returns 400 MALFORMED_JSON for a top-level primitive (strict mode)', async () => {
    const res = await request(app).post('/api/x').set('Content-Type', 'application/json').send('"abc"');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });

  it('gives 413 before 400 when a body is both oversized and malformed', async () => {
    const res = await request(app).post('/api/x').set('Content-Type', 'application/json').send(malformedOfBytes(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(res.body).toEqual(TOO_LARGE);
  });

  it('gives 400 MALFORMED_JSON before 404 ROUTE_NOT_FOUND', async () => {
    const res = await request(app).put('/api/projects/abc').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });

  it('serves GET requests without a body', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});

describe('chunked bodies (no Content-Length)', () => {
  let server;
  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('accepts exactly 102,400 bytes', async () => {
    const res = await sendChunked(server, '/api/x', jsonOfBytes(MAX_BODY_BYTES));
    expect(res.headers['content-length']).toBeDefined();
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('rejects 102,401 bytes with 413', async () => {
    const res = await sendChunked(server, '/api/x', jsonOfBytes(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(res.body).toEqual(TOO_LARGE);
    expectSecurityHeaders(res);
  });

  it('rejects an oversized malformed body with 413, not 400', async () => {
    const res = await sendChunked(server, '/api/x', malformedOfBytes(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
  });

  it('rejects a malformed body within the limit with 400 MALFORMED_JSON', async () => {
    const res = await sendChunked(server, '/api/x', malformedOfBytes(1000));
    expect(res.status).toBe(400);
    expect(res.body).toEqual(MALFORMED);
  });
});

describe('parsed body content', () => {
  // Same body middleware as createApp, with a test-only echo route (no production route added).
  const echoApp = express();
  echoApp.use(securityHeaders, bodySizeGuard, jsonBody);
  echoApp.post('/echo', (req, res) => res.json({ body: req.body ?? null }));
  echoApp.use(createErrorHandler({ logger: silentLogger }));

  it('parses a 102,400-byte JSON body intact', async () => {
    const text = jsonOfBytes(MAX_BODY_BYTES);
    const res = await request(echoApp).post('/echo').set('Content-Type', 'application/json').send(text);
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual(JSON.parse(text));
  });

  it('parses application/json with a charset parameter', async () => {
    const res = await request(echoApp).post('/echo').set('Content-Type', 'application/json; charset=utf-8').send('{"a":1}');
    expect(res.body.body).toEqual({ a: 1 });
  });

  it('leaves req.body undefined for a non-JSON content type', async () => {
    const res = await request(echoApp).post('/echo').set('Content-Type', 'text/plain').send('{"a":1}');
    expect(res.status).toBe(200);
    expect(res.body.body).toBeNull();
  });
});
