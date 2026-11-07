// Education endpoints (Requirements 17.1, 17.2, 17.5, 17.6). No SQL here (1.5).
import { ok } from '../utils/response.js';

/** @param {{ educationService: ReturnType<import('../services/educationService.js').createEducationService> }} deps */
export function createEducationController({ educationService }) {
  return {
    async list(req, res, next) {
      try {
        return ok(res, await educationService.list());
      } catch (err) {
        return next(err);
      }
    },

    async create(req, res, next) {
      try {
        return ok(res, await educationService.create(req.valid.body), 201);
      } catch (err) {
        return next(err);
      }
    },

    async update(req, res, next) {
      try {
        return ok(res, await educationService.update(req.valid.params.id, req.valid.body));
      } catch (err) {
        return next(err);
      }
    },

    async remove(req, res, next) {
      try {
        return ok(res, await educationService.remove(req.valid.params.id));
      } catch (err) {
        return next(err);
      }
    },
  };
}
