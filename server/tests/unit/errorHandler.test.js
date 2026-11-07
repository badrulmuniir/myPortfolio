import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAppConfig } from '../../src/config/env.js';
import { createErrorHandler, toAppError, UNIQUE_CONSTRAINT_FIELDS } from '../../src/middleware/errorHandler.js';
import { notFound } from '../../src/middleware/notFound.js';
import { registerProcessHandlers } from '../../src/server.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidIdError,
  MalformedJsonError,
  NotFoundError,
  PayloadTooLargeError,
  RouteNotFoundError,
  ServiceUnavailableError,
  TooManyContactSubmissionsError,
  TooManyLoginAttemptsError,
  UnauthorizedError,
  ValidationError,
} from '../../src/utils/errors.js';
import { createLogger } from '../../src/utils/logger.js';

function captureLogger() {
  const lines = [];
  const push = (l) => lines.push(l);
  return { lines, logger: createLogger({ sink: { info: push, warn: push, error: push } }) };
}

function fakeRes() {
  return {
    headersSent: false,
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

const fakeReq = (overrides = {}) => ({
  method: 'POST',
  path: '/projects',
  originalUrl: '/api/projects?token=query-secret-abc',
  headers: { authorization: 'Bearer header-token-xyz' },
  body: { password: 'body-password-123' },
  ...overrides,
});

function handle(err, { req = fakeReq(), res = fakeRes() } = {}) {
  const { lines, logger } = captureLogger();
  const next = vi.fn();
  createErrorHandler({ logger })(err, req, res, next);
  return { res, next, lines, log: lines.join('\n') };
}

describe('domain error classes', () => {
  it.each([
    [new PayloadTooLargeError(), 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 100 KB'],
    [new MalformedJsonError(), 400, 'MALFORMED_JSON', 'Request body is not valid JSON'],
    [new InvalidIdError(), 400, 'INVALID_ID', 'Invalid id'],
    [new ValidationError([]), 400, 'VALIDATION_ERROR', 'Request validation failed'],
    [new InvalidCredentialsError(), 401, 'INVALID_CREDENTIALS', 'Invalid email or password'],
    [new UnauthorizedError(), 401, 'UNAUTHORIZED', 'Authentication required'],
    [new ForbiddenError(), 403, 'FORBIDDEN', 'You do not have permission to perform this action'],
    [new NotFoundError('Project'), 404, 'NOT_FOUND', 'Project not found'],
    [new RouteNotFoundError(), 404, 'ROUTE_NOT_FOUND', 'Route not found'],
    [new ConflictError('slug'), 409, 'CONFLICT', 'A record with this value already exists'],
    [new TooManyLoginAttemptsError(), 429, 'TOO_MANY_LOGIN_ATTEMPTS', 'Too many login attempts. Please try again later.'],
    [
      new TooManyContactSubmissionsError(),
      429,
      'TOO_MANY_CONTACT_SUBMISSIONS',
      'Too many messages sent. Please try again later.',
    ],
    [new ServiceUnavailableError(), 503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable'],
  ])('%s maps to %i %s with its fixed message', (err, status, code, message) => {
    expect(err).toBeInstanceOf(AppError);
    const { res, next } = handle(err);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(status);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(code);
    expect(res.body.error.message).toBe(message);
  });

  it('includes details for InvalidIdError, ValidationError and ConflictError only', () => {
    expect(handle(new InvalidIdError()).res.body.error.details).toEqual([
      { field: 'id', reason: 'invalid_format', message: 'Id must be a positive integer' },
    ]);
    const details = [
      { field: 'title', reason: 'required', message: 'Title is required' },
      { field: 'slug', reason: 'invalid_format', message: 'Slug is invalid' },
    ];
    expect(handle(new ValidationError(details)).res.body.error.details).toEqual(details);
    expect(handle(new ConflictError('slug')).res.body.error.details).toEqual([
      { field: 'slug', reason: 'duplicate', message: 'This value is already in use' },
    ]);
    expect(handle(new ConflictError()).res.body.error).not.toHaveProperty('details');
    expect(handle(new UnauthorizedError()).res.body.error).not.toHaveProperty('details');
  });
});

describe('body-parser errors', () => {
  const bodyParserError = (type, status) => Object.assign(new Error(`raw ${type} text`), { type, status, expose: true });

  it('maps entity.parse.failed to 400 MALFORMED_JSON', () => {
    const { res } = handle(bodyParserError('entity.parse.failed', 400));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' },
    });
  });

  it('maps entity.too.large to 413 PAYLOAD_TOO_LARGE', () => {
    const { res } = handle(bodyParserError('entity.too.large', 413));
    expect(res.statusCode).toBe(413);
    expect(res.body.error).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 100 KB' });
  });

  it.each([
    ['encoding.unsupported', 415],
    ['charset.unsupported', 415],
    ['request.size.invalid', 400],
    ['request.aborted', 400],
  ])('maps %s (%i) to 400 INVALID_REQUEST_BODY', (type, status) => {
    const { res } = handle(bodyParserError(type, status));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toEqual({ code: 'INVALID_REQUEST_BODY', message: 'Request body could not be read' });
    expect(JSON.stringify(res.body)).not.toContain('raw');
  });

  it('maps a 5xx body-parser error to the generic 500', () => {
    const { res } = handle(bodyParserError('stream.not.readable', 500));
    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('works with a real express.json parser on malformed input', async () => {
    const { default: express } = await import('express');
    const app = express();
    app.use(express.json());
    app.post('/x', (req, res) => res.json({ ok: true }));
    app.use(createErrorHandler({ logger: captureLogger().logger }));
    const res = await request(app).post('/x').set('Content-Type', 'application/json').send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' },
    });
  });
});

describe('PostgreSQL unique violations', () => {
  const pgUnique = (constraint) =>
    Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
      code: '23505',
      constraint,
      detail: 'Key (slug)=(secret-value) already exists.',
    });

  it.each(Object.entries(UNIQUE_CONSTRAINT_FIELDS))('maps constraint %s to field %s', (constraint, field) => {
    const { res } = handle(pgUnique(constraint));
    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toEqual([
      { field, reason: 'duplicate', message: 'This value is already in use' },
    ]);
  });

  it('returns 409 without details or the constraint name for an unknown constraint', () => {
    const { res } = handle(pgUnique('some_internal_idx'));
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'CONFLICT', message: 'A record with this value already exists' },
    });
  });

  it('never leaks the pg message or detail', () => {
    const { res } = handle(pgUnique('projects_slug_key'));
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('duplicate key');
    expect(text).not.toContain('secret-value');
    expect(text).not.toContain('projects_slug_key');
  });

  it('maps other pg errors to the generic 500', () => {
    const err = Object.assign(new Error('relation "projects" does not exist'), { code: '42P01' });
    expect(toAppError(err).status).toBe(500);
  });
});

describe('unexpected errors', () => {
  const SQL = 'SELECT password_hash FROM admins WHERE id = $1';

  it.each(['production', 'development'])('returns a generic 500 with no internals when NODE_ENV=%s', (nodeEnv) => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = nodeEnv;
    try {
      const err = Object.assign(new Error(`syntax error in ${SQL}`), { code: '42601', query: SQL });
      const { res } = handle(err);
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      });
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('SELECT');
      expect(text).not.toContain('syntax error');
      expect(text).not.toContain('at ');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it.each([['a string'], [null], [undefined], [42], [{ weird: true }]])('maps the thrown value %j to 500', (value) => {
    const { res } = handle(value);
    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('logs method, req.path, message and stack without secrets', () => {
    const err = new Error('boom at postgres://user:pw-123@db.internal:5432/portfolio');
    const { log } = handle(err);
    expect(log).toContain('"method":"POST"');
    expect(log).toContain('"path":"/projects"');
    expect(log).toContain('boom at');
    expect(log).toContain('"stack"');
    for (const secret of ['pw-123', 'postgres://', 'query-secret-abc', 'header-token-xyz', 'body-password-123']) {
      expect(log).not.toContain(secret);
    }
  });

  it('logs a 503 with the sanitized cause', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' });
    const { log, res } = handle(new ServiceUnavailableError({ cause }));
    expect(res.statusCode).toBe(503);
    expect(log).toContain('ECONNREFUSED');
    expect(log).toContain('"path":"/projects"');
  });

  it('does not log a stack for 4xx domain errors', () => {
    const { lines } = handle(new NotFoundError('Project'));
    expect(lines).toEqual([]);
  });

  it('delegates to next when headers are already sent', () => {
    const res = fakeRes();
    res.headersSent = true;
    const err = new Error('late failure');
    const { next } = handle(err, { res });
    expect(next).toHaveBeenCalledWith(err);
    expect(res.body).toBeUndefined();
  });
});

describe('notFound and the app pipeline', () => {
  const config = loadAppConfig({
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    FRONTEND_URL: 'http://localhost:5173',
    DATABASE_URL: 'postgres://user:db-pass-xyz@db.internal:5432/portfolio',
  });
  const fakeDb = (healthCheck) => ({ healthCheck, query: async () => ({ rows: [] }) });

  it('notFound forwards a RouteNotFoundError', () => {
    const next = vi.fn();
    notFound({}, {}, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(RouteNotFoundError);
  });

  it.each([
    ['get', '/api/nope'],
    ['post', '/api/health'],
    ['delete', '/api/settings'],
    ['get', '/api'],
  ])('%s %s returns 404 ROUTE_NOT_FOUND as JSON', async (method, path) => {
    const app = createApp({ config, db: fakeDb(async () => true), logger: captureLogger().logger });
    const res = await request(app)[method](path);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' } });
  });

  it('health 503 goes through the Error_Handler with the same fixed body and a sanitized log', async () => {
    const { lines, logger } = captureLogger();
    const db = fakeDb(async () => {
      throw new Error('connect ECONNREFUSED postgres://user:db-pass-xyz@db.internal:5432/portfolio');
    });
    const res = await request(createApp({ config, db, logger })).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' },
    });
    const log = lines.join('\n');
    expect(log).toContain('"path":"/api/health"');
    expect(log).not.toContain('db-pass-xyz');
  });
});

describe('registerProcessHandlers', () => {
  it('logs a sanitized unhandled rejection and keeps running', () => {
    const { lines, logger } = captureLogger();
    const handlers = {};
    const proc = { on: (event, fn) => (handlers[event] = fn) };
    registerProcessHandlers({ logger, proc });
    expect(typeof handlers.unhandledRejection).toBe('function');
    handlers.unhandledRejection(new Error('failed for postgres://u:secret-pw@h:5432/db'));
    handlers.unhandledRejection('plain reason');
    handlers.unhandledRejection(Object.create(null));
    const log = lines.join('\n');
    expect(lines).toHaveLength(3);
    expect(log).toContain('Unhandled promise rejection');
    expect(log).toContain('plain reason');
    expect(log).not.toContain('secret-pw');
  });
});
