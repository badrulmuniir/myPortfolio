// Seed_Script CLI: `npm run seed` (Requirements 3.1–3.9).
//
// Reads ADMIN_EMAIL, ADMIN_PASSWORD and SEED_SAMPLE_CONTENT plus the Database settings from the
// environment (server/.env is loaded when present). All settings are validated before connecting,
// so invalid input writes nothing (3.2).
//
// Exit codes: 0 on success, 1 on invalid configuration or any failed step (every write rolled back).
// No output contains ADMIN_PASSWORD, the Database password, the user name or the full DATABASE_URL.
import { ConfigError, loadDbConfig, loadSeedConfig } from '../src/config/env.js';
import { describeDbError, sanitizeMessage } from '../src/db/connectionInfo.js';
import { createDb } from '../src/db/pool.js';
import { loadEnvFile } from '../src/server.js';
import { SeedError, runSeed } from '../src/services/seedService.js';
import { isEntryFile } from '../src/utils/entryFile.js';
import { logger as defaultLogger } from '../src/utils/logger.js';
import { hasher as defaultHasher } from '../src/utils/password.js';

/** Runs every loader and merges their ConfigErrors, so one message names every invalid variable. */
function loadAll(env) {
  const issues = [];
  const results = [];
  for (const load of [loadSeedConfig, loadDbConfig]) {
    try {
      results.push(load(env));
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      issues.push(...err.issues);
    }
  }
  if (issues.length > 0) throw new ConfigError(issues);
  return { seedConfig: results[0], dbConfig: results[1] };
}

/**
 * @param {{ env?: Record<string, string | undefined>, logger?: object, createDbFn?: typeof createDb,
 *   hasher?: { hash: (password: string) => Promise<string> }, run?: typeof runSeed }} [options]
 * @returns {Promise<number>} the exit code
 */
export async function main({
  env = process.env,
  logger = defaultLogger,
  createDbFn = createDb,
  hasher = defaultHasher,
  run = runSeed,
} = {}) {
  let seedConfig;
  let dbConfig;
  try {
    ({ seedConfig, dbConfig } = loadAll(env));
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // The ConfigError message holds variable names and fixed reasons only, never values.
    logger.error(err.message);
    return 1;
  }

  const secrets = [seedConfig.adminPassword];
  const db = createDbFn(dbConfig, { logger });
  try {
    const summary = await run({ db, config: seedConfig, hasher, logger });
    logger.info('Seed summary', summary);
    return 0;
  } catch (err) {
    if (err instanceof SeedError) {
      // The reason was already sanitized by runSeed.
      if (err.step === 'connect') {
        logger.error(`${err.message}. Nothing was written.`, { target: db.target ?? 'database' });
      } else {
        logger.error(`${err.message}. Every change of this run was rolled back.`);
      }
    } else {
      const reason = db.describeError ? db.describeError(err) : describeDbError(err);
      logger.error(`Seed run failed: ${sanitizeMessage(reason, secrets)}`);
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
      const secrets = process.env.ADMIN_PASSWORD ? [process.env.ADMIN_PASSWORD] : [];
      defaultLogger.error(`Seed run failed: ${sanitizeMessage(describeDbError(err), secrets)}`);
      process.exit(1);
    },
  );
}
