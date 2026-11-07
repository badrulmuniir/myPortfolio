// Access to the PostgreSQL test database for integration and property tests (Requirement 38.11).
//
// Usage in a test file of the `db` Vitest project:
//   import { getTestDb, resetDb, snapshot, closeTestDb } from '../helpers/testDb.js';
//   const db = getTestDb();
//   beforeAll(() => resetDb(db));
//   afterAll(() => closeTestDb());
//
// The migrations are applied once per run by tests/globalSetup.js before any test file starts.
import { loadDbConfig } from '../../src/config/env.js';
import { createDb } from '../../src/db/pool.js';
import { assertSafeTestDatabase } from './testDbGuard.js';

/** The tracking table of the Migration_Runner. It is never truncated or snapshotted. */
export const MIGRATIONS_TABLE = 'schema_migrations';

/**
 * Database settings for TEST_DATABASE_URL. The SSL and pool settings come from the same variables
 * the API_Server uses, so a hosted test database with DB_SSL=true works too. The PG* variables
 * are ignored because DATABASE_URL takes precedence in loadDbConfig.
 * @param {Record<string, string | undefined>} env
 */
export function testDbConfig(env = process.env) {
  const url = assertSafeTestDatabase(env);
  return loadDbConfig({
    DATABASE_URL: url,
    DB_SSL: env.DB_SSL,
    DB_SSL_REJECT_UNAUTHORIZED: env.DB_SSL_REJECT_UNAUTHORIZED,
    DB_POOL_MAX: env.DB_POOL_MAX,
  });
}

/** Creates a new db object (see src/db/pool.js) connected to TEST_DATABASE_URL. The caller ends it. */
export function createTestDb(env = process.env, options = {}) {
  return createDb(testDbConfig(env), options);
}

let shared = null;

/** Returns the db shared by the current test file, creating it on first use. */
export function getTestDb() {
  shared ??= createTestDb();
  return shared;
}

/** Ends the shared pool. Call it in `afterAll`. Safe to call when no pool was created. */
export async function closeTestDb() {
  const db = shared;
  shared = null;
  await db?.end();
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * Lists the application tables in the current schema, sorted by name, without schema_migrations.
 * The list is read from pg_tables instead of being hard-coded, so a table added by a later
 * migration is reset and snapshotted without editing this helper.
 */
export async function listAppTables(db) {
  const { rows } = await db.query(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = current_schema() AND tablename <> $1
      ORDER BY tablename`,
    [MIGRATIONS_TABLE],
  );
  return rows.map((r) => r.tablename);
}

/**
 * Empties every application table and restarts every identity sequence, in one statement.
 * schema_migrations is kept, so the schema stays migrated.
 */
export async function resetDb(db) {
  const tables = await listAppTables(db);
  if (tables.length === 0) {
    throw new Error('resetDb found no application tables. Did the test globalSetup run the migrations?');
  }
  await db.query(`TRUNCATE TABLE ${tables.map(quoteIdent).join(', ')} RESTART IDENTITY CASCADE`);
}

/** Primary-key columns of `table`, in key order. */
async function primaryKeyColumns(db, table) {
  const { rows } = await db.query(
    `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey::int2[], a.attnum)`,
    [quoteIdent(table)],
  );
  return rows.map((r) => r.attname);
}

/**
 * Returns `{ [table]: rows }` with every row of each table ordered by primary key, for
 * "the database is unchanged" assertions: `expect(await snapshot(db)).toEqual(before)`.
 * @param {object} db
 * @param {string[]} [tables] defaults to every application table
 */
export async function snapshot(db, tables) {
  const known = await listAppTables(db);
  const selected = tables ?? known;
  const unknown = selected.filter((t) => !known.includes(t));
  if (unknown.length > 0) throw new Error(`snapshot: unknown table(s) ${unknown.join(', ')}`);

  const result = {};
  for (const table of selected) {
    const keys = await primaryKeyColumns(db, table);
    const orderBy = keys.length > 0 ? ` ORDER BY ${keys.map(quoteIdent).join(', ')}` : '';
    const { rows } = await db.query(`SELECT * FROM ${quoteIdent(table)}${orderBy}`);
    result[table] = rows;
  }
  return result;
}
