// GET /api/health (Requirements 36.8, 36.9).
import { ServiceUnavailableError } from '../utils/errors.js';
import { ok } from '../utils/response.js';

/**
 * @param {{ db: { healthCheck: () => Promise<boolean> } }} deps
 *   `db.healthCheck()` resolves true when `SELECT 1` answers within 5 s (see db/pool.js).
 */
export function createHealthController({ db }) {
  return {
    async check(req, res, next) {
      let cause;
      const healthy = await Promise.resolve()
        .then(() => db.healthCheck())
        .catch((err) => {
          cause = err;
          return false;
        });
      if (healthy === true) return ok(res, { status: 'ok' });

      // The Error_Handler sends the fixed 503 body: no connection details, credentials or DB
      // error text. The original error is kept only as `cause` for the sanitized log line.
      return next(new ServiceUnavailableError({ cause }));
    },
  };
}
