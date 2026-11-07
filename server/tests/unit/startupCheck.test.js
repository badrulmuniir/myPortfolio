import { afterEach, describe, expect, it, vi } from 'vitest';
import { STARTUP_DB_TIMEOUT_MS, startServer } from '../../src/db/startupCheck.js';
import { createDb } from '../../src/db/pool.js';
import { createLogger } from '../../src/utils/logger.js';

function captureLogger() {
  const lines = [];
  const push = (l) => lines.push(l);
  return { lines, logger: createLogger({ sink: { info: push, warn: push, error: push } }) };
}

const PASSWORD = 'Very-Secret-Pw-42';
const DATABASE_URL = `postgres://portfolio:${PASSWORD}@db.example.com:5432/portfolio`;

/** createDb with a fake pool whose connect() behaves as given. */
function dbWithConnect(connect, logger) {
  return createDb(
    { connectionString: DATABASE_URL, ssl: false, poolMax: 10 },
    {
      logger,
      poolFactory: () => ({ connect, on() {}, end: async () => {} }),
    },
  );
}

const okClient = { query: async () => ({ rows: [{ '?column?': 1 }] }), release() {} };
const helloApp = (req, res) => res.end('ok');

describe('startServer', () => {
  const servers = [];
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });

  it('uses a 10 s startup timeout by default', () => {
    expect(STARTUP_DB_TIMEOUT_MS).toBe(10_000);
  });

  it('listens after the database answers SELECT 1', async () => {
    const { lines, logger } = captureLogger();
    const exit = vi.fn();
    const db = dbWithConnect(async () => okClient, logger);
    const server = await startServer(helloApp, { db, port: 0, logger, exit });
    servers.push(server);
    expect(exit).not.toHaveBeenCalled();
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
    expect(await res.text()).toBe('ok');
    expect(lines.some((l) => l.includes('listening on port'))).toBe(true);
  });

  it('logs a credential-free message and exits 1 when the database refuses the connection', async () => {
    const { lines, logger } = captureLogger();
    const exit = vi.fn();
    const createServer = vi.fn();
    const refused = Object.assign(new Error(`connect ECONNREFUSED for ${DATABASE_URL} (${PASSWORD})`), {
      code: 'ECONNREFUSED',
    });
    const db = dbWithConnect(async () => {
      throw refused;
    }, logger);
    const result = await startServer(helloApp, { db, port: 0, logger, exit, createServer });
    expect(result).toBeNull();
    expect(exit).toHaveBeenCalledWith(1);
    expect(createServer).not.toHaveBeenCalled();
    const output = lines.join('\n');
    expect(output).toContain('Cannot connect to database');
    expect(output).toContain('ECONNREFUSED');
    expect(output).toContain('db.example.com:5432/portfolio');
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain(DATABASE_URL);
  });

  it('exits 1 without listening when the database does not answer within the timeout', async () => {
    vi.useFakeTimers();
    const { lines, logger } = captureLogger();
    const exit = vi.fn();
    const createServer = vi.fn();
    const db = dbWithConnect(() => new Promise(() => {}), logger);
    const pending = startServer(helloApp, { db, port: 0, logger, exit, createServer });
    await vi.advanceTimersByTimeAsync(STARTUP_DB_TIMEOUT_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
    expect(exit).toHaveBeenCalledWith(1);
    expect(createServer).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('did not answer within 10000 ms');
  });

  it('exits 1 when the port cannot be bound', async () => {
    const { logger } = captureLogger();
    const db = dbWithConnect(async () => okClient, logger);
    const first = await startServer(helloApp, { db, port: 0, logger, exit: vi.fn() });
    servers.push(first);
    const exit = vi.fn();
    const second = await startServer(helloApp, { db, port: first.address().port, logger, exit });
    expect(second).toBeNull();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
