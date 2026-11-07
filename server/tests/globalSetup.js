// Vitest globalSetup for the `db` project: migrates TEST_DATABASE_URL once before any
// integration or property test file runs (Requirement 38.11).
//
// When the test database cannot be reached this throws, so the run fails instead of the
// database tests passing silently. Run `npm run test:unit` to run only the DB-free unit tests.
// No message printed here contains the database password, user name or full URL.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { sanitizeMessage } from '../src/db/connectionInfo.js';
import { MigrationError, runMigrations } from '../src/db/migrator.js';
import { ServiceUnavailableError } from '../src/utils/errors.js';
import { logger } from '../src/utils/logger.js';
import { createTestDb } from './helpers/testDb.js';

const HINT =
  'Create a dedicated PostgreSQL test database, set TEST_DATABASE_URL to it (see server/.env.example) ' +
  'and run the tests again. To run only the tests that need no database, use `npm run test:unit`.';

// Only info lines are dropped, so a migration run stays quiet but warnings and errors still show
// (through the redacting app logger).
const quietLogger = { ...logger, info() {} };

/** The user name in a postgres URL, raw and decoded, for redaction. */
function urlUserNames(raw) {
  try {
    const { username } = new URL(String(raw).trim());
    if (!username) return [];
    let decoded = username;
    try {
      decoded = decodeURIComponent(username);
    } catch {
      // Malformed percent-encoding: the raw form is enough.
    }
    return [...new Set([decoded, username])].sort((a, b) => b.length - a.length);
  } catch {
    return [];
  }
}

export default async function setup() {
  // Same .env loading as tests/setup.js: variables already set in the shell take precedence.
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  if (existsSync(envPath)) dotenv.config({ path: envPath, quiet: true });

  // Runs the TEST_DATABASE_URL guard before connecting.
  const db = createTestDb(process.env, { logger: quietLogger });
  try {
    await runMigrations({ db, logger: quietLogger });
  } catch (err) {
    let reason;
    if (err instanceof ServiceUnavailableError) {
      reason = `Cannot connect to the test database at ${db.target}: ${db.describeError(err)}.`;
    } else if (err instanceof MigrationError) {
      reason = `Migrating the test database at ${db.target} failed. ${err.message}.`; // already sanitized
    } else {
      reason = `Preparing the test database at ${db.target} failed: ${db.describeError(err)}.`;
    }
    // PostgreSQL names the user in some errors ("password authentication failed for user ..."),
    // and db.describeError only removes the password and URL, so the user name is removed here.
    // Thrown without `cause`, so Vitest cannot print the original pg error with connection details.
    throw new Error(`${sanitizeMessage(reason, urlUserNames(process.env.TEST_DATABASE_URL))}\n${HINT}`);
  } finally {
    await db.end().catch(() => {});
  }
}
