// Role_Guard (Requirement 7.4). Runs after the Auth_Middleware.
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

/**
 * @param {string} role the role the route requires, e.g. 'admin'
 * @returns {import('express').RequestHandler}
 */
export function requireRole(role) {
  if (typeof role !== 'string' || role.length === 0) throw new TypeError('requireRole needs a role name');

  return function roleGuard(req, res, next) {
    // Without req.auth the Auth_Middleware did not run; fail closed with 401 rather than 403.
    if (!req.auth) return next(new UnauthorizedError());
    if (req.auth.role !== role) return next(new ForbiddenError());
    return next();
  };
}
