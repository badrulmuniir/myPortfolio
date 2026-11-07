// notFound: any request under /api that no route matched → 404 ROUTE_NOT_FOUND (Requirement 4.4).
// Mounted last in the /api router; the Error_Handler writes the Error_Response.
import { RouteNotFoundError } from '../utils/errors.js';

export function notFound(req, res, next) {
  next(new RouteNotFoundError());
}
