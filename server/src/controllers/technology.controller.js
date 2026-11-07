// GET /api/technologies (Requirement 14.3).
import { ok } from '../utils/response.js';

/** @param {{ technologyService: ReturnType<import('../services/technologyService.js').createTechnologyService> }} deps */
export function createTechnologyController({ technologyService }) {
  return {
    async list(req, res, next) {
      try {
        return ok(res, await technologyService.list());
      } catch (err) {
        return next(err);
      }
    },
  };
}
