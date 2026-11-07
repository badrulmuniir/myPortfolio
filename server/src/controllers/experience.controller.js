// Experience endpoints (Requirements 16.1, 16.2, 16.9, 16.10). No SQL here (1.5).
import { ok } from '../utils/response.js';

/** @param {{ experienceService: ReturnType<import('../services/experienceService.js').createExperienceService> }} deps */
export function createExperienceController({ experienceService }) {
  return {
    /** GET /api/experiences (public). */
    async list(req, res, next) {
      try {
        return ok(res, await experienceService.list());
      } catch (err) {
        return next(err);
      }
    },

    /** POST /api/experiences (admin) → 201 with the saved record. */
    async create(req, res, next) {
      try {
        return ok(res, await experienceService.create(req.valid.body), 201);
      } catch (err) {
        return next(err);
      }
    },

    /** PUT /api/experiences/:id (admin) → 200 with the saved record. */
    async update(req, res, next) {
      try {
        return ok(res, await experienceService.update(req.valid.params.id, req.valid.body));
      } catch (err) {
        return next(err);
      }
    },

    /** DELETE /api/experiences/:id (admin) → 200 `{ id }`. */
    async remove(req, res, next) {
      try {
        return ok(res, await experienceService.remove(req.valid.params.id));
      } catch (err) {
        return next(err);
      }
    },
  };
}
