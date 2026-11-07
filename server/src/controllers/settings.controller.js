// GET /api/settings (Requirement 11.1) and PUT /api/settings (11.2).
import { ok } from '../utils/response.js';

/** @param {{ settingsService: ReturnType<import('../services/settingsService.js').createSettingsService> }} deps */
export function createSettingsController({ settingsService }) {
  return {
    async get(req, res, next) {
      try {
        return ok(res, await settingsService.getAll());
      } catch (err) {
        return next(err);
      }
    },

    async update(req, res, next) {
      try {
        return ok(res, await settingsService.update(req.valid.body));
      } catch (err) {
        return next(err);
      }
    },
  };
}
