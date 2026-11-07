// Migration_Runner CLI: `npm run migrate` (Requirements 2.7, 2.8, 2.11, 2.12).
//
// Exit codes: 0 when every migration is applied (or none is pending), 1 on invalid configuration,
// connection failure or a failed migration. No output contains the Database password, the user
// name or the full DATABASE_URL.
import { ConfigError, loadDbConfig } from '../src/config/env.js';
import { describeDbError } from '../src/db/connectionInfo.js';
import { InvalidMigrationsError, MigrationError, runMigrations } from '../src/db/migrator.js';
import { createDb } from '../src/db/pool.js';
import { loadEnvFile } from '../src/server.js';
import { ServiceUnavailableError } from '../src/utils/errors.js';
import { isEntryFile } from '../src/utils/entryFile.js';
import { logger as defaultLogger } from '../src/utils/logger.js';

/**
 * @param {{ env?: Record<string, string | undefined>, logger?: object, createDbFn?: typeof createDb,
 *   run?: typeof runMigrations, dir?: string }} [options]
 * @returns {Promise<number>} the exit code
 */
export async function main({
  env = process.env,
  logger = defaultLogger,
  createDbFn = createDb,
  run = runMigrations,
  dir,
} = {}) {
  let dbConfig;
  try {
    dbConfig = loadDbConfig(env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // The ConfigError message holds variable names and fixed reasons only, never values.
    logger.error(err.message);
    return 1;
  }

  const db = createDbFn(dbConfig, { logger });
  const describe = (err) => (db.describeError ? db.describeError(err) : describeDbError(err));
  try {
    await run({ db, logger, ...(dir === undefined ? {} : { dir }) });
    return 0;
  } catch (err) {
    if (err instanceof ServiceUnavailableError) {
      logger.error(`Cannot connect to database: ${describe(err)}`, { target: db.target ?? 'database' });
    } else if (err instanceof MigrationError) {
      // The reason was already sanitized by the runner.
      logger.error(err.message, { applied: err.applied });
    } else if (err instanceof InvalidMigrationsError) {
      logger.error(err.message);
    } else {
      logger.error(`Migration run failed: ${describe(err)}`);
    }
    return 1;
  } finally {
    try {
      await db.end?.();
    } catch {
      // Closing the pool after a failure must not change the exit code.
    }
  }
}

if (isEntryFile(import.meta.url)) {
  loadEnvFile();
  main().then(
    (code) => process.exit(code),
    (err) => {
      defaultLogger.error(`Migration run failed: ${describeDbError(err)}`);
      process.exit(1);
    },
  );
}
