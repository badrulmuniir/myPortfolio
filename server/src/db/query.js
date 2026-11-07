// Single-statement queries through the pool (Requirements 1.7, 35.9).
//
// A failure to acquire a client (pool wait over connectionTimeoutMillis, refused connection,
// authentication or SSL failure) becomes ServiceUnavailableError (503). Errors from the query
// itself pass through unchanged so the Error_Handler can map them (for example 23505 → 409).
import { ServiceUnavailableError } from '../utils/errors.js';

/** Acquires a pooled client, turning any acquire failure into ServiceUnavailableError. */
export async function acquireClient(pool) {
  try {
    return await pool.connect();
  } catch (err) {
    throw new ServiceUnavailableError({ cause: err });
  }
}

const SQLSTATE_RE = /^[0-9A-Z]{5}$/;

/**
 * True when the client should be discarded instead of returned to the pool.
 * Errors reported by the PostgreSQL server carry a SQLSTATE code and leave the connection usable.
 * Anything else (ECONNRESET, protocol errors) may leave it broken.
 */
export function isBrokenConnectionError(err) {
  return err !== undefined && !(typeof err?.code === 'string' && SQLSTATE_RE.test(err.code));
}

/**
 * Returns `withClient(work)`: runs `work(client)` on one pooled client held for the whole call,
 * where `client.query(text, params)` runs on that client. Used when several statements must share
 * one session, such as a session-level advisory lock held across several transactions.
 * The client is always released, and destroyed when `work` throws a non-SQLSTATE error.
 */
export function createWithClient(pool) {
  return async function withClient(work) {
    const client = await acquireClient(pool);
    let failure;
    try {
      const session = Object.freeze({ query: (text, params) => client.query(text, params) });
      return await work(session);
    } catch (err) {
      failure = err;
      throw err;
    } finally {
      client.release(isBrokenConnectionError(failure) ? failure : undefined);
    }
  };
}

/** @returns {(text: string, params?: unknown[]) => Promise<import('pg').QueryResult>} */
export function createQuery(pool) {
  return async function query(text, params) {
    const client = await acquireClient(pool);
    let failure;
    try {
      return await client.query(text, params);
    } catch (err) {
      failure = err;
      throw err;
    } finally {
      // pg destroys the client when release() receives a truthy value.
      client.release(isBrokenConnectionError(failure) ? failure : undefined);
    }
  };
}
