// Profile routes.
// - GET /api/profile is public and never reads the Authorization header (7.6, 7.9).
// - PUT /api/profile is admin-only; `requireAdmin` runs before `validate` (7.1, 7.8).
import { Router } from 'express';
import { createProfileController } from '../controllers/profile.controller.js';
import { adminOnly } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createProfileService } from '../services/profileService.js';
import { profileBody } from '../validators/profile.schemas.js';

/**
 * @param {{ db: object, config: object, clock?: object, logger?: object,
 *   requireAdmin?: ReadonlyArray<import('express').RequestHandler> }} deps
 *   `requireAdmin` is the shared [authenticate, requireRole('admin')] pair from routes/index.js;
 *   it is built here only when the router is created on its own.
 */
export function createProfileRouter({ db, config, clock, requireAdmin = adminOnly({ db, config, clock }) }) {
  const router = Router();
  const profile = createProfileController({ profileService: createProfileService({ db }) });
  router.get('/profile', profile.get);
  router.put('/profile', ...requireAdmin, validate({ body: profileBody }), profile.update);
  return router;
}
