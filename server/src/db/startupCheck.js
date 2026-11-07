// Startup Database check and HTTP listener (Requirements 36.7, 1.6).
//
// The Database must answer `SELECT 1` within 10 seconds before the server listens. On failure
// the server logs a credential-free message and exits with status 1 without listening.
import http from 'node:http';
import { logger as defaultLogger } from '../utils/logger.js';
import { withTimeout } from '../utils/withTimeout.js';
import { describeDbError } from './connectionInfo.js';

export const STARTUP_DB_TIMEOUT_MS = 10_000;

/**
 * @param {import('express').Express | http.RequestListener} app
 * @param {{ db: { query: Function, end?: Function, target?: string, describeError?: Function },
 *   port: number, logger?: object, timeoutMs?: number, exit?: (code: number) => void,
 *   createServer?: typeof http.createServer }} options
 * @returns {Promise<http.Server | null>} the listening server, or null after `exit(1)`
 */
export async function startServer(
  app,
  {
    db,
    port,
    logger = defaultLogger,
    timeoutMs = STARTUP_DB_TIMEOUT_MS,
    exit = (code) => process.exit(code),
    createServer = http.createServer,
  },
) {
  const describe = (err) => (db.describeError ? db.describeError(err) : describeDbError(err));

  try {
    await withTimeout(db.query('SELECT 1'), timeoutMs, `Database did not answer within ${timeoutMs} ms`);
  } catch (err) {
    logger.error('Cannot connect to database', { target: db.target ?? 'database', reason: describe(err) });
    // Do not wait: a pending connection attempt could delay the exit.
    Promise.resolve()
      .then(() => db.end?.())
      .catch(() => {});
    exit(1);
    return null;
  }

  const server = createServer(app);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (err) {
    logger.error('Cannot start HTTP listener', { port, reason: err?.code ?? err?.message });
    Promise.resolve()
      .then(() => db.end?.())
      .catch(() => {});
    exit(1);
    return null;
  }

  logger.info(`API server listening on port ${server.address().port}`);
  return server;
}
