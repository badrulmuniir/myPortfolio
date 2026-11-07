// Unit tests for the Migration_Runner and its CLI, using a fake client (no PostgreSQL needed).
// Requirements 2.6, 2.7, 2.8, 2.11, 2.12.
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/migrate.js';
import {
  InvalidMigrationsError,
  MIGRATIONS_DIR,
  MIGRATION_LOCK_KEY,
  MigrationError,
  SQL,
  listMigrationFiles,
  runMigrations,
} from '../../src/db/migrator.js';
import { createDb } from '../../src/db/pool.js';
import { createLogger } from '../../src/utils/logger.js';

const dirs = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});

/** Creates a temporary migrations directory holding `files` ({ name: sql }). */
function migrationsDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'portfolio-migrations-'));
  dirs.push(dir);
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

function captureLogger() {
  const lines = [];
  const push = (l) => lines.push(l);
  return { lines, logger: createLogger({ sink: { info: push, warn: push, error: push } }) };
}

const sqlError = (code, message) => Object.assign(new Error(message), { code });

/**
 * A fake db whose single client records statements and models schema_migrations with
 * transactions: rows inserted inside BEGIN … COMMIT become visible only on COMMIT.
 */
function fakeDb({ recorded = [], failOn = () => undefined } = {}) {
  const state = { statements: [], committed: new Map(recorded), lockHeld: false, clients: 0, open: false };
  let staged = null;
  const client = {
    async query(text, params) {
      state.statements.push(text);
      const failure = failOn(text, params);
      if (failure) throw failure;
      if (text === SQL.lock) state.lockHeld = true;
      if (text === SQL.unlock) state.lockHeld = false;
      if (text === SQL.begin) staged = new Map();
      if (text === SQL.record) staged.set(params[0], params[1]);
      if (text === SQL.commit) {
        for (const [v, n] of staged) state.committed.set(v, n);
        staged = null;
      }
      if (text === SQL.rollback) staged = null;
      if (text === SQL.selectApplied) {
        return { rows: [...state.committed].map(([version, name]) => ({ version, name })) };
      }
      return { rows: [] };
    },
  };
  const db = {
    state,
    async withClient(work) {
      state.clients += 1;
      state.open = true;
      try {
        return await work(client);
      } finally {
        state.open = false;
      }
    },
  };
  return db;
}

const THREE = {
  '001_first.sql': 'CREATE TABLE one ();',
  '002_second.sql': 'CREATE TABLE two ();',
  '003_third.sql': 'CREATE TABLE three ();',
};

describe('listMigrationFiles', () => {
  it('ignores files that do not match the naming rule and sorts by numeric version', async () => {
    const dir = migrationsDir({
      '.gitkeep': '',
      'README.md': 'x',
      '010_ten.sql': 'x',
      '0100_hundred.sql': 'x',
      '099_ninety_nine.sql': 'x',
      '002_two.sql': 'x',
      '01_too_short.sql': 'x',
      '004_Upper.sql': 'x',
      '005_five.SQL': 'x',
      '006_six.sql.bak': 'x',
    });
    mkdirSync(join(dir, '007_directory.sql'));
    const files = await listMigrationFiles(dir);
    expect(files.map((f) => f.name)).toEqual(['002_two.sql', '010_ten.sql', '099_ninety_nine.sql', '0100_hundred.sql']);
    expect(files.map((f) => f.version)).toEqual([2, 10, 99, 100]);
  });

  it('rejects two files with the same numeric version', async () => {
    const dir = migrationsDir({ '001_a.sql': 'x', '0001_b.sql': 'x', '002_c.sql': 'x' });
    await expect(listMigrationFiles(dir)).rejects.toThrow(InvalidMigrationsError);
    await expect(listMigrationFiles(dir)).rejects.toThrow(/0001_b\.sql.*001_a\.sql|001_a\.sql.*0001_b\.sql/);
  });

  it('finds the ten project migrations and nothing else', async () => {
    const files = await listMigrationFiles(MIGRATIONS_DIR);
    expect(files.map((f) => f.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(files[0].name).toBe('001_init_functions.sql');
    expect(files[9].name).toBe('010_create_settings.sql');
  });
});

describe('runMigrations', () => {
  it('applies every migration in order on an empty database, each in its own transaction', async () => {
    const db = fakeDb();
    const { lines, logger } = captureLogger();
    const result = await runMigrations({ db, dir: migrationsDir({ ...THREE, '.gitkeep': '' }), logger });

    expect(result).toEqual({ applied: ['001_first.sql', '002_second.sql', '003_third.sql'] });
    expect(db.state.statements).toEqual([
      SQL.lock,
      SQL.createTable,
      SQL.selectApplied,
      ...['one', 'two', 'three'].flatMap((t) => [SQL.begin, `CREATE TABLE ${t} ();`, SQL.record, SQL.commit]),
      SQL.unlock,
    ]);
    expect([...db.state.committed]).toEqual([
      [1, '001_first.sql'],
      [2, '002_second.sql'],
      [3, '003_third.sql'],
    ]);
    expect(db.state.clients).toBe(1);
    expect(db.state.lockHeld).toBe(false);
    expect(lines.join('\n')).toContain('Applied migration 002_second.sql');
  });

  it('runs no migration statements and reports "No pending migrations" when all are applied', async () => {
    const db = fakeDb({ recorded: [[1, '001_first.sql'], [2, '002_second.sql'], [3, '003_third.sql']] });
    const { lines, logger } = captureLogger();
    const result = await runMigrations({ db, dir: migrationsDir(THREE), logger });

    expect(result).toEqual({ applied: [] });
    expect(db.state.statements).toEqual([SQL.lock, SQL.createTable, SQL.selectApplied, SQL.unlock]);
    expect(db.state.committed.size).toBe(3);
    expect(lines.join('\n')).toContain('No pending migrations');
  });

  it('applies only the migrations not yet recorded', async () => {
    const db = fakeDb({ recorded: [[1, '001_first.sql']] });
    const { logger } = captureLogger();
    const result = await runMigrations({ db, dir: migrationsDir(THREE), logger });
    expect(result.applied).toEqual(['002_second.sql', '003_third.sql']);
    expect(db.state.statements).not.toContain('CREATE TABLE one ();');
  });

  it('stops at a failing migration: earlier kept, failing rolled back and unrecorded, later not run', async () => {
    const db = fakeDb({
      failOn: (text) => (text === 'CREATE TABLE two ();' ? sqlError('42601', 'syntax error at or near "two"') : undefined),
    });
    const { logger } = captureLogger();
    const run = runMigrations({ db, dir: migrationsDir(THREE), logger });

    await expect(run).rejects.toThrow(MigrationError);
    const err = await run.catch((e) => e);
    expect(err.migration).toBe('002_second.sql');
    expect(err.message).toBe('Migration 002_second.sql failed: 42601: syntax error at or near "two"');
    expect(err.applied).toEqual(['001_first.sql']);
    expect([...db.state.committed]).toEqual([[1, '001_first.sql']]);
    expect(db.state.statements).not.toContain('CREATE TABLE three ();');
    expect(db.state.statements.slice(-3)).toEqual(['CREATE TABLE two ();', SQL.rollback, SQL.unlock]);
    expect(db.state.lockHeld).toBe(false);
  });

  it('releases the lock when the run fails before any migration', async () => {
    const db = fakeDb({
      failOn: (text) => (text === SQL.createTable ? sqlError('42501', 'permission denied for schema public') : undefined),
    });
    const { logger } = captureLogger();
    await expect(runMigrations({ db, dir: migrationsDir(THREE), logger })).rejects.toThrow('permission denied');
    expect(db.state.statements).toEqual([SQL.lock, SQL.createTable, SQL.unlock]);
    expect(db.state.lockHeld).toBe(false);
  });

  it('passes the lock key to both lock and unlock', async () => {
    const params = [];
    const db = fakeDb({
      failOn: (text, p) => {
        if (text === SQL.lock || text === SQL.unlock) params.push(p);
        return undefined;
      },
    });
    const { logger } = captureLogger();
    await runMigrations({ db, dir: migrationsDir(THREE), logger });
    expect(params).toEqual([[MIGRATION_LOCK_KEY], [MIGRATION_LOCK_KEY]]);
  });

  it('rejects duplicate versions before connecting', async () => {
    const db = fakeDb();
    const { logger } = captureLogger();
    const dir = migrationsDir({ '001_a.sql': 'x', '001_b.sql': 'y' });
    await expect(runMigrations({ db, dir, logger })).rejects.toThrow(InvalidMigrationsError);
    expect(db.state.clients).toBe(0);
    expect(db.state.statements).toEqual([]);
  });

  it('warns about a recorded version with no file and still applies pending ones', async () => {
    const db = fakeDb({ recorded: [[1, '001_first.sql'], [5, '005_deleted.sql']] });
    const { lines, logger } = captureLogger();
    const result = await runMigrations({ db, dir: migrationsDir(THREE), logger });
    expect(result.applied).toEqual(['002_second.sql', '003_third.sql']);
    expect(lines.some((l) => l.includes('WARN') && l.includes('005_deleted.sql'))).toBe(true);
  });

  it('strips a UTF-8 byte order mark from the file', async () => {
    const db = fakeDb();
    const { logger } = captureLogger();
    await runMigrations({ db, dir: migrationsDir({ '001_bom.sql': '\uFEFFSELECT 1;' }), logger });
    expect(db.state.statements).toContain('SELECT 1;');
  });
});

describe('createDb().withClient', () => {
  it('runs every statement on one client and releases it once', async () => {
    const statements = [];
    const released = [];
    const client = {
      async query(text) {
        statements.push(text);
        return { rows: [] };
      },
      release: (arg) => released.push(arg),
    };
    const pool = new EventEmitter();
    let connects = 0;
    pool.connect = async () => {
      connects += 1;
      return client;
    };
    pool.end = async () => {};
    const db = createDb({ host: 'h', port: 5432, user: 'u', database: 'd', ssl: false, poolMax: 1 }, { poolFactory: () => pool });
    const { logger } = captureLogger();
    await runMigrations({ db, dir: migrationsDir(THREE), logger });
    expect(connects).toBe(1);
    expect(released).toEqual([undefined]);
    expect(statements[0]).toBe(SQL.lock);
    expect(statements.at(-1)).toBe(SQL.unlock);
  });
});

describe('migrate CLI main', () => {
  const PASSWORD = 'Sup3r-S3cret-pw';
  const DATABASE_URL = `postgres://portfolio_user:${PASSWORD}@db.example.com:6543/portfolio`;

  it('exits 1 with a credential-free message when the database cannot be reached', async () => {
    const { lines, logger } = captureLogger();
    const connectError = Object.assign(new Error(`connect ECONNREFUSED for ${DATABASE_URL} (${PASSWORD})`), {
      code: 'ECONNREFUSED',
    });
    const pool = new EventEmitter();
    pool.connect = async () => {
      throw connectError;
    };
    pool.end = vi.fn(async () => {});
    const code = await main({
      env: { DATABASE_URL },
      logger,
      createDbFn: (cfg, opts) => createDb(cfg, { ...opts, poolFactory: () => pool }),
      dir: migrationsDir(THREE),
    });

    expect(code).toBe(1);
    expect(pool.end).toHaveBeenCalled();
    const output = lines.join('\n');
    expect(output).toContain('Cannot connect to database: ECONNREFUSED');
    expect(output).toContain('db.example.com:6543/portfolio');
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain('portfolio_user');
    expect(output).not.toContain(DATABASE_URL);
  });

  it('exits 1 naming only the invalid variables on a ConfigError, without creating a db', async () => {
    const { lines, logger } = captureLogger();
    const createDbFn = vi.fn();
    const code = await main({ env: { PGPASSWORD: PASSWORD, DB_SSL: 'maybe' }, logger, createDbFn });
    expect(code).toBe(1);
    expect(createDbFn).not.toHaveBeenCalled();
    const output = lines.join('\n');
    for (const name of ['PGHOST', 'PGUSER', 'PGDATABASE', 'DB_SSL']) expect(output).toContain(name);
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain('maybe');
  });

  it('exits 0 after a successful run and closes the pool', async () => {
    const { logger } = captureLogger();
    const db = { ...fakeDb(), end: vi.fn(async () => {}) };
    const code = await main({ env: { DATABASE_URL }, logger, createDbFn: () => db, dir: migrationsDir(THREE) });
    expect(code).toBe(0);
    expect(db.end).toHaveBeenCalledTimes(1);
  });

  it('exits 1 and names the failing migration when one fails', async () => {
    const { lines, logger } = captureLogger();
    const db = {
      ...fakeDb({ failOn: (t) => (t === 'CREATE TABLE three ();' ? sqlError('42P07', 'relation "three" already exists') : undefined) }),
      end: vi.fn(async () => {}),
    };
    const code = await main({ env: { DATABASE_URL }, logger, createDbFn: () => db, dir: migrationsDir(THREE) });
    expect(code).toBe(1);
    expect(db.end).toHaveBeenCalledTimes(1);
    expect(lines.join('\n')).toContain('Migration 003_third.sql failed: 42P07: relation "three" already exists');
  });
});
