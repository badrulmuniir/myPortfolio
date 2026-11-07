// Unit tests for the database access layer, using fake pools and clients (no PostgreSQL needed).
import { EventEmitter } from 'node:events';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectSecrets, describeDbError, describeTarget } from '../../src/db/connectionInfo.js';
import {
  CONNECTION_TIMEOUT_MS,
  buildPoolOptions,
  createDb,
  createHealthCheck,
  stripSslParams,
} from '../../src/db/pool.js';
import { createQuery } from '../../src/db/query.js';
import { createWithTransaction } from '../../src/db/transaction.js';
import { DATE_OID, registerTypeParsers } from '../../src/db/typeParsers.js';
import { ServiceUnavailableError } from '../../src/utils/errors.js';

/** A fake pg client that records statements and can fail on chosen statements. */
function fakeClient({ failOn = {} } = {}) {
  const client = {
    statements: [],
    released: [],
    async query(text, params) {
      client.statements.push(text);
      if (failOn[text]) throw failOn[text];
      return { rows: [{ text, params }], rowCount: 1 };
    },
    release(arg) {
      client.released.push(arg);
    },
  };
  return client;
}

function fakePool({ client, connectError } = {}) {
  const pool = new EventEmitter();
  pool.connect = async () => {
    if (connectError) throw connectError;
    return client;
  };
  pool.end = vi.fn(async () => {});
  return pool;
}

const sqlError = (code, message = 'server error') => Object.assign(new Error(message), { code });

describe('registerTypeParsers', () => {
  it('returns DATE (OID 1082) values as the stored YYYY-MM-DD string', () => {
    registerTypeParsers();
    const parse = pg.types.getTypeParser(DATE_OID, 'text');
    expect(parse('2024-01-31')).toBe('2024-01-31');
  });

  it('registers on an injected types object', () => {
    const types = { setTypeParser: vi.fn() };
    registerTypeParsers(types);
    expect(types.setTypeParser).toHaveBeenCalledWith(1082, expect.any(Function));
  });
});

describe('buildPoolOptions', () => {
  it('uses the connection string, pool size, 5 s acquire timeout and ssl setting', () => {
    const options = buildPoolOptions({
      connectionString: 'postgres://u:p@h:5432/db',
      ssl: { rejectUnauthorized: true },
      poolMax: 7,
    });
    expect(options).toEqual({
      connectionString: 'postgres://u:p@h:5432/db',
      max: 7,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      ssl: { rejectUnauthorized: true },
    });
    expect(CONNECTION_TIMEOUT_MS).toBe(5000);
  });

  it('uses the individual PG* settings when there is no connection string', () => {
    const options = buildPoolOptions({
      host: 'h',
      port: 5433,
      user: 'u',
      password: 'p',
      database: 'db',
      ssl: false,
      poolMax: 10,
    });
    expect(options).toEqual({
      host: 'h',
      port: 5433,
      user: 'u',
      password: 'p',
      database: 'db',
      max: 10,
      connectionTimeoutMillis: 5000,
      ssl: false,
    });
  });

  it('strips SSL parameters from DATABASE_URL so DB_SSL is the only switch', () => {
    expect(stripSslParams('postgres://u:p@h/db?sslmode=disable&application_name=x')).toBe(
      'postgres://u:p@h/db?application_name=x',
    );
    expect(stripSslParams('postgres://u:p@h/db')).toBe('postgres://u:p@h/db');
  });
});

describe('query', () => {
  it('returns the result and releases the client normally', async () => {
    const client = fakeClient();
    const query = createQuery(fakePool({ client }));
    const result = await query('SELECT $1', [1]);
    expect(result.rows[0]).toEqual({ text: 'SELECT $1', params: [1] });
    expect(client.released).toEqual([undefined]);
  });

  it('turns an acquire failure into ServiceUnavailableError and keeps the cause', async () => {
    const cause = new Error('timeout exceeded when trying to connect');
    const query = createQuery(fakePool({ connectError: cause }));
    const err = await query('SELECT 1').catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(err).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' });
    expect(err.cause).toBe(cause);
  });

  it('passes query errors through unchanged and returns the client to the pool', async () => {
    const dup = sqlError('23505', 'duplicate key');
    const client = fakeClient({ failOn: { 'INSERT x': dup } });
    const query = createQuery(fakePool({ client }));
    await expect(query('INSERT x')).rejects.toBe(dup);
    expect(client.released).toEqual([undefined]);
  });

  it('destroys the client after a connection-level error', async () => {
    const reset = Object.assign(new Error('Connection terminated'), { code: 'ECONNRESET' });
    const client = fakeClient({ failOn: { 'SELECT 1': reset } });
    const query = createQuery(fakePool({ client }));
    await expect(query('SELECT 1')).rejects.toBe(reset);
    expect(client.released).toEqual([reset]);
  });
});

describe('withTransaction', () => {
  it('runs BEGIN, the work and COMMIT on one client, then releases it', async () => {
    const client = fakeClient();
    const withTransaction = createWithTransaction(fakePool({ client }));
    const result = await withTransaction(async (tx) => {
      await tx.query('INSERT a');
      await tx.query('INSERT b');
      return 'done';
    });
    expect(result).toBe('done');
    expect(client.statements).toEqual(['BEGIN', 'INSERT a', 'INSERT b', 'COMMIT']);
    expect(client.released).toEqual([undefined]);
  });

  it('rolls back and rethrows when the work throws', async () => {
    const client = fakeClient();
    const withTransaction = createWithTransaction(fakePool({ client }));
    const failure = new Error('step failed');
    const err = await withTransaction(async (tx) => {
      await tx.query('INSERT a');
      throw failure;
    }).catch((e) => e);
    expect(err).toBe(failure);
    expect(client.statements).toEqual(['BEGIN', 'INSERT a', 'ROLLBACK']);
    expect(client.released).toEqual([undefined]);
  });

  it('rolls back when COMMIT fails', async () => {
    const commitError = sqlError('40001', 'serialization failure');
    const client = fakeClient({ failOn: { COMMIT: commitError } });
    const withTransaction = createWithTransaction(fakePool({ client }));
    await expect(withTransaction(async () => 1)).rejects.toBe(commitError);
    expect(client.statements).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
    expect(client.released).toEqual([undefined]);
  });

  it('destroys the client when ROLLBACK fails, still rethrowing the original error', async () => {
    const rollbackError = new Error('connection lost');
    const client = fakeClient({ failOn: { ROLLBACK: rollbackError } });
    const withTransaction = createWithTransaction(fakePool({ client }));
    const failure = new Error('work failed');
    await expect(
      withTransaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(client.released).toEqual([rollbackError]);
  });

  it('turns an acquire failure into ServiceUnavailableError without running the work', async () => {
    const work = vi.fn();
    const withTransaction = createWithTransaction(fakePool({ connectError: new Error('ECONNREFUSED') }));
    await expect(withTransaction(work)).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(work).not.toHaveBeenCalled();
  });
});

describe('healthCheck', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves true when SELECT 1 answers', async () => {
    const query = vi.fn(async () => ({ rows: [{ '?column?': 1 }] }));
    await expect(createHealthCheck(query)()).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('resolves false when the query fails', async () => {
    const query = async () => {
      throw new ServiceUnavailableError();
    };
    await expect(createHealthCheck(query)()).resolves.toBe(false);
  });

  it('resolves false when the query does not answer within 5 s', async () => {
    vi.useFakeTimers();
    const query = () => new Promise(() => {});
    const pending = createHealthCheck(query)();
    await vi.advanceTimersByTimeAsync(4999);
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(false);
  });
});

describe('createDb', () => {
  it('builds the pool from the config and exposes the access functions', async () => {
    const client = fakeClient();
    let captured;
    const db = createDb(
      { host: 'db.local', port: 5432, user: 'u', password: 'pw-123', database: 'portfolio', ssl: false, poolMax: 3 },
      {
        poolFactory: (options) => {
          captured = options;
          return fakePool({ client });
        },
      },
    );
    expect(captured).toMatchObject({ max: 3, connectionTimeoutMillis: 5000, ssl: false });
    expect(db.target).toBe('db.local:5432/portfolio');
    await expect(db.healthCheck()).resolves.toBe(true);
    await db.withTransaction((tx) => tx.query('INSERT a'));
    expect(client.statements).toEqual(['SELECT 1', 'BEGIN', 'INSERT a', 'COMMIT']);
  });

  it('logs idle client errors without secrets', () => {
    const errors = [];
    const logger = { info() {}, warn() {}, error: (msg, meta) => errors.push(JSON.stringify({ msg, meta })) };
    const pool = fakePool({ client: fakeClient() });
    const url = 'postgres://admin:S3cr%3Ft@db.example.com:6543/portfolio';
    createDb({ connectionString: url, ssl: false, poolMax: 10 }, { logger, poolFactory: () => pool });
    pool.emit('error', new Error(`terminated for ${url} using S3cr?t`));
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain('S3cr');
    expect(errors[0]).not.toContain('admin:');
    expect(errors[0]).toContain('db.example.com:6543/portfolio');
  });
});

describe('connection info', () => {
  it('describes the target without credentials', () => {
    expect(describeTarget({ connectionString: 'postgresql://user:pw@host.io:6000/app' })).toBe('host.io:6000/app');
    expect(describeTarget({ connectionString: 'postgres://user:pw@host.io/app' })).toBe('host.io:5432/app');
    expect(describeTarget({ host: 'h', port: 5432, database: 'd', password: 'x' })).toBe('h:5432/d');
  });

  it('removes passwords and connection strings from error reasons', () => {
    const url = 'postgres://me:p%40ss@h/db';
    const secrets = collectSecrets({ connectionString: url });
    const reason = describeDbError(
      Object.assign(new Error(`failed ${url} p@ss p%40ss postgres://other:x@y/z`), { code: '28P01' }),
      secrets,
    );
    expect(reason.startsWith('28P01: failed')).toBe(true);
    expect(reason).not.toMatch(/p@ss|p%40ss|postgres:\/\//);
  });

  it('unwraps ServiceUnavailableError and AggregateError causes', () => {
    const inner = Object.assign(new AggregateError([new Error('connect ECONNREFUSED ::1:5432')], ''), {
      code: 'ECONNREFUSED',
    });
    const reason = describeDbError(new ServiceUnavailableError({ cause: inner }));
    expect(reason).toBe('ECONNREFUSED: connect ECONNREFUSED ::1:5432');
  });
});
