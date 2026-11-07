// Admin protection for routers (Requirements 7.1, 7.8).
//
// `routes/index.js` calls `adminOnly(deps)` once per app and passes the result to every router
// as `deps.requireAdmin`. A router protects a route by spreading it before `validate`, so a
// 401 or 403 is sent before any params, query or body check runs (7.8):
//
//   router.put('/skills/:id', ...requireAdmin, validate({ params: idParams, body: skillBody }), handler);
import { createAuthenticate } from './authenticate.js';
import { requireRole } from './requireRole.js';

export { createAuthenticate, parseBearer, parseSubject } from './authenticate.js';
export { requireRole } from './requireRole.js';

/**
 * @param {{ db: { query: Function }, config: { jwtSecret: string }, clock?: { now: () => number | Date } }} deps
 * @returns {ReadonlyArray<import('express').RequestHandler>} [authenticate, requireRole('admin')]
 */
export function adminOnly({ db, config, clock }) {
  return Object.freeze([createAuthenticate({ db, config, clock }), requireRole('admin')]);
}
