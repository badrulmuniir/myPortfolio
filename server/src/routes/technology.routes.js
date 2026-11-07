// Technology routes (Requirements 14.3, 7.1).
// - GET /api/technologies is admin-only: it feeds the suggestions of the Project form.
import { Router } from 'express';
import { createTechnologyController } from '../controllers/technology.controller.js';
import { adminOnly } from '../middleware/auth.js';
import { createTechnologyService } from '../services/technologyService.js';

/**
 * @param {{ db: object, config: object, clock?: object, logger?: object,
 *   requireAdmin?: ReadonlyArray<import('express').RequestHandler> }} deps
 *   `requireAdmin` is the shared [authenticate, requireRole('admin')] pair from routes/index.js;
 *   it is built here only when the router is created on its own.
 */
export function createTechnologyRouter({ db, config, clock, requireAdmin = adminOnly({ db, config, clock }) }) {
  const router = Router();
  const technologies = createTechnologyController({ technologyService: createTechnologyService({ db }) });
  router.get('/technologies', ...requireAdmin, technologies.list);
  return router;
}
