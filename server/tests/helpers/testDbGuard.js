// Guards the server test suite against running on a non-test database (Requirement 38.11).
// Error messages name variables only and never include their values, because URLs carry credentials.

/**
 * Returns the trimmed TEST_DATABASE_URL when it is safe to use, otherwise throws.
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function assertSafeTestDatabase(env = process.env) {
  const testUrl = (env.TEST_DATABASE_URL ?? '').trim();
  const devUrl = (env.DATABASE_URL ?? '').trim();

  if (testUrl === '') {
    throw new Error(
      'Refusing to run server tests: TEST_DATABASE_URL is not set. ' +
        'Point it at a dedicated test database (see server/.env.example).',
    );
  }
  if (testUrl === devUrl) {
    throw new Error(
      'Refusing to run server tests: TEST_DATABASE_URL equals DATABASE_URL. ' +
        'Use a separate database for tests so development data is not reset.',
    );
  }
  return testUrl;
}
