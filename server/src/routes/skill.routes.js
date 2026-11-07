// Skill routes (Requirements 15.1, 15.2, 15.7, 15.8, 7.1, 7.6, 7.8).
// - GET /api/skills is public and never reads the Authorization header.
// - POST, PUT and DELETE are admin-only. `requireAdmin` runs before `validate`, so a request
//   without a valid admin token gets 401/403 before the id or body is checked (7.8).
import { Router } from 'express';
import { createSkillController } from '../controllers/skill.controller.js';
import { adminOnly } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createSkillService } from '../services/skillService.js';
import { idParams } from '../validators/params.schemas.js';
import { skillBody } from '../validators/skill.schemas.js';

/**
 * @param {{ db: object, config: object, clock?: object, logger?: object,
 *   requireAdmin?: ReadonlyArray<import('express').RequestHandler> }} deps
 *   `requireAdmin` is the shared [authenticate, requireRole('admin')] pair from routes/index.js;
 *   it is built here only when the router is created on its own.
 */
export function createSkillRouter({ db, config, clock, requireAdmin = adminOnly({ db, config, clock }) }) {
  const router = Router();
  const skills = createSkillController({ skillService: createSkillService({ db }) });
  router.get('/skills', skills.list);
  router.post('/skills', ...requireAdmin, validate({ body: skillBody }), skills.create);
  router.put('/skills/:id', ...requireAdmin, validate({ params: idParams, body: skillBody }), skills.update);
  router.delete('/skills/:id', ...requireAdmin, validate({ params: idParams }), skills.remove);
  return router;
}
