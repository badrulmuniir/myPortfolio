// Auth_Middleware (Requirements 7.2, 7.3, 7.5, 7.7, 7.8).
//
// Checks, in order; any failure passes the same 401 UNAUTHORIZED error to `next`:
// 1. The Authorization header matches /^Bearer ([^\s]+)$/i: Bearer scheme in any case, one
//    space, one non-empty token and nothing after it (7.2).
// 2. jwt.verify with HS256 only, so `none` and every other algorithm are rejected. Expiry is
//    checked against the injected clock; jsonwebtoken treats `exp <= now` as expired, which is
//    the "at or before" rule in 7.3. A token without a numeric `exp` is also rejected, because
//    every token the API_Server issues has one.
// 3. `sub` is the canonical decimal string of an id from 1 to 2,147,483,647 and `role` is a
//    non-empty string (7.3).
// 4. The admin row exists (7.5).
//
// Database errors are not authentication failures: they go to the Error_Handler unchanged
// (500, or 503 when the pool cannot connect). The token is never logged or put in an error.
//
// On success `req.auth = { id, email, role }`: id and email from the Database, role from the
// token (design: Middleware table). The Role_Guard then decides on that role.
import jwt from 'jsonwebtoken';
import { JWT_ALGORITHM, SQL } from '../services/authService.js';
import { UnauthorizedError } from '../utils/errors.js';
import { ID_MAX } from '../validators/params.schemas.js';

const BEARER = /^Bearer ([^\s]+)$/i;
const CANONICAL_ID = /^[1-9][0-9]{0,9}$/;

const systemClock = { now: () => Date.now() };

/**
 * Extracts the token from an Authorization header value.
 * @param {unknown} header
 * @returns {string | null} null when the header is missing or not `Bearer <token>`
 */
export function parseBearer(header) {
  if (typeof header !== 'string') return null;
  const match = BEARER.exec(header);
  return match ? match[1] : null;
}

/**
 * Admin id from the `sub` claim, or null when it is not a canonical id string.
 * @param {unknown} sub
 * @returns {number | null}
 */
export function parseSubject(sub) {
  if (typeof sub !== 'string' || !CANONICAL_ID.test(sub)) return null;
  const id = Number(sub);
  return id <= ID_MAX ? id : null;
}

/**
 * Verifies the token and its claims. Returns the admin id and token role, or null when the token
 * fails any check in steps 2 and 3.
 * @returns {{ id: number, role: string } | null}
 */
function verifyClaims(token, secret, clockTimestamp) {
  let payload;
  try {
    payload = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM], clockTimestamp });
  } catch {
    // JsonWebTokenError, TokenExpiredError and NotBeforeError all mean "not authenticated".
    return null;
  }
  if (payload === null || typeof payload !== 'object') return null;
  if (typeof payload.exp !== 'number') return null;
  const id = parseSubject(payload.sub);
  if (id === null) return null;
  if (typeof payload.role !== 'string' || payload.role.length === 0) return null;
  return { id, role: payload.role };
}

/**
 * Builds the Auth_Middleware. Create it once per app (see `middleware/auth.js`).
 * @param {{ db: { query: Function }, config: { jwtSecret: string }, clock?: { now: () => number | Date } }} deps
 * @returns {import('express').RequestHandler}
 */
export function createAuthenticate({ db, config, clock = systemClock }) {
  if (!db) throw new TypeError('createAuthenticate requires db');
  if (!config?.jwtSecret) throw new TypeError('createAuthenticate requires config.jwtSecret');

  return async function authenticate(req, res, next) {
    try {
      const token = parseBearer(req.get('authorization'));
      if (token === null) return next(new UnauthorizedError());

      // Whole seconds, as in the `exp` claim. jsonwebtoken ignores a clockTimestamp of 0, which
      // is fine: the real clock is never at the epoch.
      const clockTimestamp = Math.floor(new Date(clock.now()).getTime() / 1000);
      const claims = verifyClaims(token, config.jwtSecret, clockTimestamp);
      if (claims === null) return next(new UnauthorizedError());

      const { rows } = await db.query(SQL.findById, [claims.id]);
      const row = rows[0];
      if (!row) return next(new UnauthorizedError());

      req.auth = { id: row.id, email: row.email, role: claims.role };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
