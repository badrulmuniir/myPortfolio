// Rate limiting middleware (Requirements 8.1, 8.2, 8.3, 8.5, 8.6; design Middleware table).
//
// - The key is `req.ip`. With TRUST_PROXY=true the app sets `trust proxy` to 1, so `req.ip` is
//   the client address from one reverse-proxy hop; otherwise it is the socket address and
//   X-Forwarded-For is ignored.
// - A blocked key gets `Retry-After` and the endpoint's 429 error, passed to the Error_Handler so
//   the body is an Error_Response. Nothing after this middleware runs, so credentials are not
//   checked and contact messages are not validated or stored.
// - Otherwise the request continues, and when the response finishes with `countWhen(res)` true,
//   the request is recorded. 429 responses are never recorded because they never reach that step.
import { TooManyContactSubmissionsError, TooManyLoginAttemptsError } from '../utils/errors.js';

/**
 * @param {{ check: (key: string) => { blocked: boolean, retryAfterSeconds?: number },
 *   record: (key: string) => void }} limiter
 * @param {{ countWhen: (res: import('express').Response) => boolean, createError: () => Error }} options
 * @returns {import('express').RequestHandler}
 */
export function rateLimit(limiter, { countWhen, createError }) {
  if (typeof limiter?.check !== 'function' || typeof limiter?.record !== 'function') {
    throw new TypeError('rateLimit requires a limiter with check and record');
  }
  if (typeof countWhen !== 'function') throw new TypeError('rateLimit requires countWhen');
  if (typeof createError !== 'function') throw new TypeError('rateLimit requires createError');

  return function rateLimitMiddleware(req, res, next) {
    const key = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const verdict = limiter.check(key);
    if (verdict.blocked) {
      res.set('Retry-After', String(verdict.retryAfterSeconds));
      return next(createError());
    }
    res.on('finish', () => {
      if (countWhen(res)) limiter.record(key);
    });
    return next();
  };
}

/**
 * Login limiter middleware. The login route has no auth middleware, so a 401 there always means
 * invalid credentials; only those responses count (8.1).
 * @param {Parameters<typeof rateLimit>[0]} limiter
 */
export const loginRateLimit = (limiter) =>
  rateLimit(limiter, {
    countWhen: (res) => res.statusCode === 401,
    createError: () => new TooManyLoginAttemptsError(),
  });

/**
 * Contact limiter middleware. Only 201 responses count, which includes submissions discarded
 * because of a filled Honeypot_Field; 400 and 429 responses do not count (8.2).
 * @param {Parameters<typeof rateLimit>[0]} limiter
 */
export const contactRateLimit = (limiter) =>
  rateLimit(limiter, {
    countWhen: (res) => res.statusCode === 201,
    createError: () => new TooManyContactSubmissionsError(),
  });
