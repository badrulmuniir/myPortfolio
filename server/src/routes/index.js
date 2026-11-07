// Builds the router mounted at /api. Every resource router is created from the same
// dependencies and mounted before the notFound handler, which must stay last (4.4).
// `routeTable.js` lists every mounted endpoint; a unit test keeps the two in sync.
//
// Admin protection: `requireAdmin` ([authenticate, requireRole('admin')]) is built once here and
// passed to every router in `deps`. Routers apply it as `...requireAdmin` before `validate`.
//
// Rate limiting: the login and contact Rate_Limiters are created once per app (or injected as
// `deps.loginLimiter` / `deps.contactLimiter`, so tests can inspect them) and passed to the auth
// and contact routers.
//
// No router uses `router.use()` middleware and no two routers share a (method, path) pair, so
// mount order cannot shadow a route. Public project reads (GET /projects, /projects/:identifier)
// and admin project reads (GET /admin/projects[/:id]) have different prefixes, and the admin
// writes on /projects/:id use methods other than GET.
import { Router } from 'express';
import { adminOnly } from '../middleware/auth.js';
import { notFound } from '../middleware/notFound.js';
import { createContactLimiter, createLoginLimiter } from '../utils/rateLimiter.js';
import { createAuthRouter } from './auth.routes.js';
import { createContactRouter } from './contact.routes.js';
import { createDashboardRouter } from './dashboard.routes.js';
import { createEducationRouter } from './education.routes.js';
import { createExperienceRouter } from './experience.routes.js';
import { createHealthRouter } from './health.routes.js';
import { createProfileRouter } from './profile.routes.js';
import { createProjectRouter } from './project.routes.js';
import { createSettingsRouter } from './settings.routes.js';
import { createSkillRouter } from './skill.routes.js';
import { createTechnologyRouter } from './technology.routes.js';

export { listRoutes, ROUTES } from './routeTable.js';

/** Router factories in mount order (the same order as the design's endpoint catalog). */
const ROUTER_FACTORIES = Object.freeze([
  createHealthRouter,
  createAuthRouter,
  createProfileRouter,
  createSettingsRouter,
  createProjectRouter,
  createTechnologyRouter,
  createSkillRouter,
  createExperienceRouter,
  createEducationRouter,
  createContactRouter,
  createDashboardRouter,
]);

/**
 * @param {{ config: object, db: object, clock?: { now: () => number | Date }, logger?: object,
 *   hasher?: unknown, loginLimiter?: ReturnType<typeof createLoginLimiter>,
 *   contactLimiter?: ReturnType<typeof createContactLimiter> }} deps
 * @returns {import('express').Router}
 */
export function createApiRouter(deps) {
  const routerDeps = {
    ...deps,
    requireAdmin: adminOnly(deps),
    loginLimiter: deps.loginLimiter ?? createLoginLimiter({ clock: deps.clock }),
    contactLimiter: deps.contactLimiter ?? createContactLimiter({ clock: deps.clock }),
  };
  const router = Router();
  for (const createRouter of ROUTER_FACTORIES) router.use(createRouter(routerDeps));
  router.use(notFound);
  return router;
}
