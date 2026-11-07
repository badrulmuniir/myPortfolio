import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadEnvFile, main } from '../../src/server.js';
import { createLogger } from '../../src/utils/logger.js';

function captureLogger() {
  const lines = [];
  const push = (l) => lines.push(l);
  return { lines, logger: createLogger({ sink: { info: push, warn: push, error: push } }) };
}

const SHORT_SECRET = 'short-secret-value';
const DB_PASSWORD = 'db-pass-xyz-123';

describe('main', () => {
  it('logs the invalid variable names without values and exits 1 on a ConfigError', async () => {
    const { lines, logger } = captureLogger();
    const exit = vi.fn();
    const createDbFn = vi.fn();
    const start = vi.fn();
    const result = await main({
      env: {
        JWT_SECRET: SHORT_SECRET,
        FRONTEND_URL: '',
        PGPASSWORD: DB_PASSWORD,
        DB_POOL_MAX: 'pool-value-xyz',
      },
      logger,
      exit,
      createDbFn,
      start,
    });
    expect(result).toBeNull();
    expect(exit).toHaveBeenCalledWith(1);
    expect(createDbFn).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    const output = lines.join('\n');
    for (const name of ['JWT_SECRET', 'FRONTEND_URL', 'PGHOST', 'PGUSER', 'PGDATABASE', 'DB_POOL_MAX']) {
      expect(output).toContain(name);
    }
    expect(output).not.toContain(SHORT_SECRET);
    expect(output).not.toContain(DB_PASSWORD);
    expect(output).not.toContain('pool-value-xyz');
  });

  it('creates the db from config.db, builds the app and starts it on the configured port', async () => {
    const { logger } = captureLogger();
    const exit = vi.fn();
    const db = { healthCheck: async () => true, query: async () => ({ rows: [] }) };
    const createDbFn = vi.fn(() => db);
    const server = { fake: true };
    const start = vi.fn(async () => server);
    const result = await main({
      env: {
        JWT_SECRET: 'x'.repeat(32),
        FRONTEND_URL: 'http://localhost:5173',
        DATABASE_URL: 'postgres://u:p@localhost:5432/portfolio',
        PORT: '5050',
      },
      logger,
      exit,
      createDbFn,
      start,
    });
    expect(result).toBe(server);
    expect(exit).not.toHaveBeenCalled();
    expect(createDbFn).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: 'postgres://u:p@localhost:5432/portfolio', poolMax: 10 }),
      { logger },
    );
    const [app, options] = start.mock.calls[0];
    expect(typeof app).toBe('function');
    expect(options).toMatchObject({ db, port: 5050, logger, exit });
  });
});

describe('loadEnvFile', () => {
  it('does nothing when the file does not exist', () => {
    expect(() => loadEnvFile(join(tmpdir(), 'portfolio-no-such-dir', '.env'))).not.toThrow();
  });

  it('loads variables from the file without overriding ones already set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portfolio-env-'));
    const path = join(dir, '.env');
    writeFileSync(path, 'PORTFOLIO_TEST_A=from-file\nPORTFOLIO_TEST_B=from-file\n');
    process.env.PORTFOLIO_TEST_B = 'from-shell';
    try {
      loadEnvFile(path);
      expect(process.env.PORTFOLIO_TEST_A).toBe('from-file');
      expect(process.env.PORTFOLIO_TEST_B).toBe('from-shell');
    } finally {
      delete process.env.PORTFOLIO_TEST_A;
      delete process.env.PORTFOLIO_TEST_B;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
