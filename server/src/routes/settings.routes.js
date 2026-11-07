// Settings routes.
// - GET /api/settings is public and never reads the Authorization header (7.6, 7.9).
// - PUT /api/settings is admin-only. `requireAdmin` runs before `validate`, so a request without
//   a valid admin token gets 401/403 before its body is checked (7.8).
import { Router } from 'express';
import { createSettingsController } from '../controllers/settings.controller.js';
import { adminOnly } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createSettingsService } from '../services/settingsService.js';
import { settingsBody } from '../validators/settings.schemas.js';

/**
 * @param {{ db: object, config: object, clock?: object, logger?: object,
 *   requireAdmin?: ReadonlyArray<import('express').RequestHandler> }} deps
 *   `requireAdmin` is the shared [authenticate, requireRole('admin')] pair from routes/index.js;
 *   it is built here only when the router is created on its own.
 */
export function createSettingsRouter({ db, config, clock, requireAdmin = adminOnly({ db, config, clock }) }) {
  const router = Router();
  const settings = createSettingsController({ settingsService: createSettingsService({ db }) });
  router.get('/settings', settings.get);
  router.put('/settings', ...requireAdmin, validate({ body: settingsBody }), settings.update);
  return router;
}
