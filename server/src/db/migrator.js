// Migration_Runner (Requirements 2.6, 2.7, 2.8, 2.11, 2.12).
//
// Applies the SQL files in server/migrations that are not yet recorded in `schema_migrations`,
// in ascending numeric version order, each in its own transaction. The whole run holds a
// session-level advisory lock on one client, so two concurrent runs cannot interleave.
//
// Rules:
// - Only files matching MIGRATION_FILE_RE count as migrations. Anything else (.gitkeep, README)
//   is ignored.
// - Two files with the same numeric version (for example 001_a.sql and 0001_b.sql) are an error,
//   reported before the database is touched.
// - A version recorded in `schema_migrations` with no matching file is logged as a warning and
//   does not fail the run. Deleting an applied migration file is a mistake worth noticing, but
//   refusing to run would block every later migration in that environment.
// - The first failing migration is rolled back, stays unrecorded, and stops the run. Migrations
//   applied earlier in the same run stay applied and recorded.
import { readFile as fsReadFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger as defaultLogger } from '../utils/logger.js';
import { describeDbError } from './connectionInfo.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
export const MIGRATION_FILE_RE = /^(\d{3,})_[a-z0-9_]+\.sql$/;

/** Key for pg_advisory_lock. Any constant works, as long as nothing else in the app uses it. */
export const MIGRATION_LOCK_KEY = '7230512026';

const MAX_VERSION = 2_147_483_647; // schema_migrations.version is INTEGER

export const SQL = Object.freeze({
  lock: 'SELECT pg_advisory_lock($1::bigint)',
  unlock: 'SELECT pg_advisory_unlock($1::bigint)',
  createTable:
    'CREATE TABLE IF NOT EXISTS schema_migrations (' +
    'version INTEGER PRIMARY KEY, ' +
    'name TEXT NOT NULL, ' +
    'applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  selectApplied: 'SELECT version, name FROM schema_migrations ORDER BY version',
  begin: 'BEGIN',
  record: 'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
  commit: 'COMMIT',
  rollback: 'ROLLBACK',
});

/** The migration files themselves are invalid (duplicate or out-of-range versions). */
export class InvalidMigrationsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidMigrationsError';
  }
}

/** One migration failed. `applied` lists the migrations committed earlier in the same run. */
export class MigrationError extends Error {
  /** @param {{ migration: string, reason: string, applied: string[], cause?: unknown }} options */
  constructor({ migration, reason, applied, cause }) {
    super(`Migration ${migration} failed: ${reason}`, cause === undefined ? undefined : { cause });
    this.name = 'MigrationError';
    this.migration = migration;
    this.reason = reason;
    this.applied = applied;
  }
}

/**
 * Lists the migration files in `dir`, sorted by numeric version.
 * @param {string} dir
 * @returns {Promise<{ version: number, name: string, path: string }[]>}
 * @throws {InvalidMigrationsError} on duplicate or out-of-range versions
 */
export async function listMigrationFiles(dir = MIGRATIONS_DIR) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  const problems = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = MIGRATION_FILE_RE.exec(entry.name);
    if (!match) continue;
    const version = Number(match[1]);
    if (!Number.isSafeInteger(version) || version > MAX_VERSION) {
      problems.push(`${entry.name} has a version above ${MAX_VERSION}`);
      continue;
    }
    files.push({ version, name: entry.name, path: join(dir, entry.name) });
  }

  files.sort((a, b) => a.version - b.version || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let i = 1; i < files.length; i += 1) {
    if (files[i].version === files[i - 1].version) {
      problems.push(`${files[i - 1].name} and ${files[i].name} share version ${files[i].version}`);
    }
  }
  if (problems.length > 0) throw new InvalidMigrationsError(`Invalid migration files: ${problems.join('; ')}`);
  return files;
}

/**
 * Applies every pending migration.
 * @param {{ db: { withClient: (work: (client: { query: Function }) => Promise<unknown>) => Promise<unknown>,
 *   describeError?: (err: unknown) => string }, dir?: string, logger?: object,
 *   readFile?: (path: string) => Promise<string> }} options
 * @returns {Promise<{ applied: string[] }>} names of the files applied in this run, in order
 * @throws {MigrationError | InvalidMigrationsError | Error} ServiceUnavailableError (from
 *   `db.withClient`) when the Database cannot be reached; nothing is applied in that case
 */
export async function runMigrations({
  db,
  dir = MIGRATIONS_DIR,
  logger = defaultLogger,
  readFile = (path) => fsReadFile(path, 'utf8'),
}) {
  const describe = (err) => (db.describeError ? db.describeError(err) : describeDbError(err));
  // Read the directory before connecting, so invalid files are reported without touching the Database.
  const files = await listMigrationFiles(dir);

  return db.withClient(async (client) => {
    await client.query(SQL.lock, [MIGRATION_LOCK_KEY]);
    try {
      await client.query(SQL.createTable);
      const { rows } = await client.query(SQL.selectApplied);
      const appliedVersions = new Set(rows.map((r) => Number(r.version)));

      const fileVersions = new Set(files.map((f) => f.version));
      for (const row of rows) {
        if (!fileVersions.has(Number(row.version))) {
          logger.warn('Recorded migration has no file', { version: Number(row.version), name: row.name });
        }
      }

      const pending = files.filter((f) => !appliedVersions.has(f.version));
      if (pending.length === 0) {
        logger.info('No pending migrations');
        return { applied: [] };
      }

      const applied = [];
      for (const file of pending) {
        await applyOne(client, file, { readFile, describe, applied });
        applied.push(file.name);
        logger.info(`Applied migration ${file.name}`);
      }
      logger.info(`Applied ${applied.length} migration(s)`);
      return { applied };
    } finally {
      try {
        await client.query(SQL.unlock, [MIGRATION_LOCK_KEY]);
      } catch (err) {
        // The lock is session-level, so it is released anyway when the connection closes.
        logger.warn('Could not release the migration lock', { reason: describe(err) });
      }
    }
  });
}

async function applyOne(client, file, { readFile, describe, applied }) {
  let sql;
  try {
    // Strip a UTF-8 byte order mark that some Windows editors add.
    sql = String(await readFile(file.path)).replace(/^\uFEFF/, '');
  } catch (err) {
    throw new MigrationError({ migration: file.name, reason: describe(err), applied: [...applied], cause: err });
  }

  try {
    await client.query(SQL.begin);
    await client.query(sql);
    await client.query(SQL.record, [file.version, file.name]);
    await client.query(SQL.commit);
  } catch (err) {
    try {
      await client.query(SQL.rollback);
    } catch {
      // A failed ROLLBACK means the connection is gone; the server discards the transaction.
    }
    throw new MigrationError({ migration: file.name, reason: describe(err), applied: [...applied], cause: err });
  }
}
