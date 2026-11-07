// Database access object built on a pg Pool (Requirements 1.7, 9.3, 35.7, 35.9, 36.4, 36.6, 36.8).
import pg from 'pg';
import { logger as defaultLogger } from '../utils/logger.js';
import { withTimeout } from '../utils/withTimeout.js';
import { collectSecrets, describeDbError, describeTarget } from './connectionInfo.js';
import { createQuery, createWithClient } from './query.js';
import { createWithTransaction } from './transaction.js';
import { registerTypeParsers } from './typeParsers.js';

export const CONNECTION_TIMEOUT_MS = 5000;
export const HEALTH_CHECK_TIMEOUT_MS = 5000;

// Connection-string parameters that would override the `ssl` option. DB_SSL is the only switch,
// so an `sslmode=disable` in DATABASE_URL cannot turn SSL off when DB_SSL=true (36.6).
const SSL_URL_PARAMS = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslpassword', 'uselibpqcompat'];

/** Removes SSL parameters from a postgres connection string. */
export function stripSslParams(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }
  if (!SSL_URL_PARAMS.some((p) => url.searchParams.has(p))) return connectionString;
  for (const p of SSL_URL_PARAMS) url.searchParams.delete(p);
  return url.toString();
}

/**
 * Maps the output of loadDbConfig to pg Pool options.
 * @param {ReturnType<import('../config/env.js').loadDbConfig>} dbConfig
 */
export function buildPoolOptions(dbConfig) {
  const connection = dbConfig.connectionString
    ? { connectionString: stripSslParams(dbConfig.connectionString) }
    : {
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
      };
  return {
    ...connection,
    max: dbConfig.poolMax,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    // `false`, or `{ rejectUnauthorized }` when DB_SSL=true. With an ssl object pg never
    // retries without TLS.
    ssl: dbConfig.ssl,
  };
}

/** Returns `healthCheck()` resolving true when `SELECT 1` answers within `timeoutMs`, else false. */
export function createHealthCheck(query, { timeoutMs = HEALTH_CHECK_TIMEOUT_MS } = {}) {
  return async function healthCheck() {
    try {
      await withTimeout(query('SELECT 1'), timeoutMs);
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * @param {ReturnType<import('../config/env.js').loadDbConfig>} dbConfig
 * @param {{ logger?: object, poolFactory?: (options: object) => import('pg').Pool,
 *   healthCheckTimeoutMs?: number }} [options]
 */
export function createDb(
  dbConfig,
  {
    logger = defaultLogger,
    poolFactory = (options) => new pg.Pool(options),
    healthCheckTimeoutMs = HEALTH_CHECK_TIMEOUT_MS,
  } = {},
) {
  registerTypeParsers();
  const pool = poolFactory(buildPoolOptions(dbConfig));
  const secrets = collectSecrets(dbConfig);
  const target = describeTarget(dbConfig);
  const describeError = (err) => describeDbError(err, secrets);

  // Without a listener, an error on an idle client would crash the process (1.8).
  pool.on('error', (err) => {
    logger.error('Idle database client error', { target, reason: describeError(err) });
  });

  const query = createQuery(pool);
  return Object.freeze({
    query,
    withTransaction: createWithTransaction(pool),
    /** Runs `work(client)` on one dedicated client (for session-level state such as advisory locks). */
    withClient: createWithClient(pool),
    healthCheck: createHealthCheck(query, { timeoutMs: healthCheckTimeoutMs }),
    end: () => pool.end(),
    /** `host:port/database`, safe to log. */
    target,
    /** Log-safe reason for a Database error. */
    describeError,
  });
}
