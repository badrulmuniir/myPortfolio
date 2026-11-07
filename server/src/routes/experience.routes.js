// Experience routes.
// - GET /api/experiences is public and never reads the Authorization header (7.6, 7.9).
// - POST, PUT /:id and DELETE /:id are admin-only; `requireAdmin` runs before `validate`, so a
//   401 or 403 is sent before any id or body check (7.1, 7.8).
import { Router } from 'express';
import { createExperienceController } from '../controllers/experience.controller.js';
import { adminOnly } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createExperienceService } from '../services/experienceService.js';
import { experienceBody } from '../validators/experience.schemas.js';
import { idParams } from '../validators/params.schemas.js';

/**
 * @param {{ db: object, config: object, clock?: object, logger?: object,
 *   requireAdmin?: ReadonlyArray<import('express').RequestHandler> }} deps
 *   `requireAdmin` is the shared [authenticate, requireRole('admin')] pair from routes/index.js;
 *   it is built here only when the router is created on its own.
 */
export function createExperienceRouter({ db, config, clock, requireAdmin = adminOnly({ db, config, clock }) }) {
  const router = Router();
  const experiences = createExperienceController({ experienceService: createExperienceService({ db }) });
  router.get('/experiences', experiences.list);
  router.post('/experiences', ...requireAdmin, validate({ body: experienceBody }), experiences.create);
  router.put(
    '/experiences/:id',
    ...requireAdmin,
    validate({ params: idParams, body: experienceBody }),
    experiences.update,
  );
  router.delete('/experiences/:id', ...requireAdmin, validate({ params: idParams }), experiences.remove);
  return router;
}
