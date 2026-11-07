import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { assertSafeTestDatabase } from '../helpers/testDbGuard.js';

const TEST_URL = 'postgres://user:secret-test@localhost:5432/portfolio_test';
const DEV_URL = 'postgres://user:secret-dev@localhost:5432/portfolio_dev';

describe('test tooling', () => {
  it('configures fast-check to run at least 100 inputs per property', () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(100);

    let runs = 0;
    fc.assert(
      fc.property(fc.integer(), () => {
        runs += 1;
      }),
    );
    expect(runs).toBeGreaterThanOrEqual(100);
  });
});

describe('assertSafeTestDatabase', () => {
  it('returns TEST_DATABASE_URL when it differs from DATABASE_URL', () => {
    expect(assertSafeTestDatabase({ TEST_DATABASE_URL: TEST_URL, DATABASE_URL: DEV_URL })).toBe(TEST_URL);
    expect(assertSafeTestDatabase({ TEST_DATABASE_URL: ` ${TEST_URL} ` })).toBe(TEST_URL);
  });

  it.each([
    ['unset', { DATABASE_URL: DEV_URL }],
    ['empty', { TEST_DATABASE_URL: '', DATABASE_URL: DEV_URL }],
    ['whitespace only', { TEST_DATABASE_URL: '   ', DATABASE_URL: DEV_URL }],
  ])('refuses when TEST_DATABASE_URL is %s', (_label, env) => {
    expect(() => assertSafeTestDatabase(env)).toThrow(/TEST_DATABASE_URL is not set/);
  });

  it('refuses when TEST_DATABASE_URL equals DATABASE_URL, without printing the URL', () => {
    let message = '';
    try {
      assertSafeTestDatabase({ TEST_DATABASE_URL: DEV_URL, DATABASE_URL: `${DEV_URL} ` });
    } catch (err) {
      message = err.message;
    }
    expect(message).toMatch(/TEST_DATABASE_URL equals DATABASE_URL/);
    expect(message).not.toContain('secret-dev');
    expect(message).not.toContain('postgres://');
  });
});
