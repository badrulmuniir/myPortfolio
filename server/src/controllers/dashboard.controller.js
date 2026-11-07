// GET /api/dashboard/stats (Requirements 20.1, 20.6).
import { ok } from '../utils/response.js';

/** @param {{ dashboardService: ReturnType<import('../services/dashboardService.js').createDashboardService> }} deps */
export function createDashboardController({ dashboardService }) {
  return {
    async stats(req, res, next) {
      try {
        return ok(res, await dashboardService.stats());
      } catch (err) {
        return next(err);
      }
    },
  };
}
