// GET /api/profile (Requirement 10.1, 10.12) and PUT /api/profile (10.2, 10.10, 10.12).
import { ok } from '../utils/response.js';

/** @param {{ profileService: ReturnType<import('../services/profileService.js').createProfileService> }} deps */
export function createProfileController({ profileService }) {
  return {
    async get(req, res, next) {
      try {
        return ok(res, await profileService.get());
      } catch (err) {
        return next(err);
      }
    },

    async update(req, res, next) {
      try {
        return ok(res, await profileService.update(req.valid.body));
      } catch (err) {
        return next(err);
      }
    },
  };
}
