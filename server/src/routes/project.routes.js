// Project routes (Requirements 12.1–12.6, 12.10, 13.1–13.6, 13.13, 13.17–13.19, 7.1, 7.6, 7.8, 7.9).
// - GET /api/projects and GET /api/projects/:identifier are public: no admin middleware runs and
//   the Authorization header is never read, so any token (valid, expired or garbage) gives the
//   same response as no token (12.6).
// - The identifier is classified in the controller (classifyIdentifier), not by idParams, because
//   it may be an id or a Slug.
// - Every other route is admin-only. `requireAdmin` runs before `validate`, so a request without
//   a valid admin token gets 401/403 before the id or body is checked (7.8). The admin reads live
//   under /admin/projects, so they never meet the public GET /projects/:identifier route; the
//   admin writes on /projects/:id use other methods than GET.
import { Router } from 'express';
import { createProjectController } from '../controllers/project.controller.js';
import { adminOnly } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createProjectService } from '../services/projectService.js';
import { idParams } from '../validators/params.schemas.js';
import { projectBody, publicProjectQuery, publishBody } from '../validators/project.schemas.js';

/**
 * @param {{ db: object, config: object, clock?: object, logger?: object,
 *   requireAdmin?: ReadonlyArray<import('express').RequestHandler> }} deps
 *   `requireAdmin` is the shared [authenticate, requireRole('admin')] pair from routes/index.js;
 *   it is built here only when the router is created on its own.
 */
export function createProjectRouter({ db, config, clock, requireAdmin = adminOnly({ db, config, clock }) }) {
  const router = Router();
  const projects = createProjectController({ projectService: createProjectService({ db }) });

  router.get('/projects', validate({ query: publicProjectQuery }), projects.listPublic);
  router.get('/projects/:identifier', projects.getPublic);

  router.get('/admin/projects', ...requireAdmin, projects.listAdmin);
  router.get('/admin/projects/:id', ...requireAdmin, validate({ params: idParams }), projects.getAdmin);
  router.post('/projects', ...requireAdmin, validate({ body: projectBody }), projects.create);
  router.put('/projects/:id', ...requireAdmin, validate({ params: idParams, body: projectBody }), projects.update);
  router.patch(
    '/projects/:id/publish',
    ...requireAdmin,
    validate({ params: idParams, body: publishBody }),
    projects.setPublished,
  );
  router.delete('/projects/:id', ...requireAdmin, validate({ params: idParams }), projects.remove);
  return router;
}
