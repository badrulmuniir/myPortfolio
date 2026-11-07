// Education routes (Requirement 17).
// - GET /api/education is public and never reads the Authorization header (7.9).
// - POST, PUT /:id and DELETE /:id are admin-only; `requireAdmin` runs before `validate` (7.8).
import { Router } from 'express';
import { createEducationController } from '../controllers/education.controller.js';
import { adminOnly } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createEducationService } from '../services/educationService.js';
import { createEducationBody } from '../validators/education.schemas.js';
import { idParams } from '../validators/params.schemas.js';

const systemClock = { now: () => Date.now() };

/**
 * @param {{ config: object, db: object, clock?: { now: () => number | Date }, logger?: object,
 *   requireAdmin?: ReadonlyArray<import('express').RequestHandler> }} deps
 *   `clock` sets the current year for the "current year + 10" bound (17.3). `requireAdmin` is
 *   the shared [authenticate, requireRole('admin')] pair from routes/index.js; it is built here
 *   only when the router is created on its own.
 */
export function createEducationRouter({ config, db, clock = systemClock, requireAdmin = adminOnly({ db, config, clock }) }) {
  const router = Router();
  const education = createEducationController({ educationService: createEducationService({ db }) });
  const body = createEducationBody({ clock });

  router.get('/education', education.list);
  router.post('/education', ...requireAdmin, validate({ body }), education.create);
  router.put('/education/:id', ...requireAdmin, validate({ params: idParams, body }), education.update);
  router.delete('/education/:id', ...requireAdmin, validate({ params: idParams }), education.remove);
  return router;
}
