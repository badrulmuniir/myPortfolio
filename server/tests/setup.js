// Vitest setup file, run before every server test file.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import fc from 'fast-check';
import { assertSafeTestDatabase } from './helpers/testDbGuard.js';

// Load server/.env when present. Variables already set in the shell take precedence.
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) {
  dotenv.config({ path: envPath, quiet: true });
}

// Stop before any test runs when the test database is missing or is the development database.
assertSafeTestDatabase(process.env);

// Every property-based test runs at least 100 generated inputs (38.9).
fc.configureGlobal({ numRuns: 100 });
