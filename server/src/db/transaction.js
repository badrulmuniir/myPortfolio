// Multi-statement writes in one transaction (Requirements 1.7, 4.8, 14.4, 14.5).
import { acquireClient } from './query.js';

/**
 * Returns `withTransaction(work)`. `work` receives `tx` with `tx.query(text, params)`, all on one
 * client. COMMIT on success; ROLLBACK on any throw, after which the original error is rethrown.
 * The client is always released, and destroyed when ROLLBACK itself fails.
 */
export function createWithTransaction(pool) {
  return async function withTransaction(work) {
    const client = await acquireClient(pool);
    let rollbackError;
    try {
      await client.query('BEGIN');
      const tx = Object.freeze({ query: (text, params) => client.query(text, params) });
      const result = await work(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        rollbackError = rbErr;
      }
      throw err;
    } finally {
      client.release(rollbackError ?? undefined);
    }
  };
}
