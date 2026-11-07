// Dashboard routes (Requirements 20.1, 20.5, 7.1).
// GET /api/dashboard/stats is admin-only: a request without a valid admin token gets 401/403
// from `requireAdmin` before any count is queried (20.5).
import { Router } from 'express';
import { createDashboardController } from '../controllers/dashboard.controller.js';
import { adminOnly } from '../middleware/auth.js';
import { createDashboardService } from '../services/dashboardService.js';

/**
 * @param {{ db: object, config: object, clock?: object, logger?: object,
 *   requireAdmin?: ReadonlyArray<import('express').RequestHandler> }} deps
 *   `requireAdmin` is the shared [authenticate, requireRole('admin')] pair from routes/index.js;
 *   it is built here only when the router is created on its own.
 */
export function createDashboardRouter({ db, config, clock, requireAdmin = adminOnly({ db, config, clock }) }) {
  const router = Router();
  const dashboard = createDashboardController({ dashboardService: createDashboardService({ db }) });
  router.get('/dashboard/stats', ...requireAdmin, dashboard.stats);
  return router;
}
