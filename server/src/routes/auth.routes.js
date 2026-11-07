// Authentication routes.
// - POST /api/auth/login is public: no Auth_Middleware runs and any Authorization header is
//   ignored (5.10). The login Rate_Limiter runs before `validate`, so a blocked IP gets 429
//   without its body being validated or its credentials checked (8.1).
// - GET /api/auth/me is admin-only (6.1, 7.1).
import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller.js';
import { adminOnly } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { createAuthService } from '../services/authService.js';
import { createLoginLimiter } from '../utils/rateLimiter.js';
import { loginBody } from '../validators/auth.schemas.js';

/**
 * @param {{ config: object, db: object, hasher?: object, clock?: object,
 *   requireAdmin?: ReadonlyArray<import('express').RequestHandler>,
 *   loginLimiter?: ReturnType<typeof createLoginLimiter> }} deps
 *   `requireAdmin` is the shared [authenticate, requireRole('admin')] pair and `loginLimiter` the
 *   per-app login Rate_Limiter from routes/index.js; both are built here only when the router is
 *   created on its own.
 */
export function createAuthRouter({
  config,
  db,
  hasher,
  clock,
  requireAdmin = adminOnly({ db, config, clock }),
  loginLimiter = createLoginLimiter({ clock }),
}) {
  const router = Router();
  const authService = createAuthService({ db, config, hasher, clock });
  const auth = createAuthController({ authService });
  router.post('/auth/login', loginRateLimit(loginLimiter), validate({ body: loginBody }), auth.login);
  router.get('/auth/me', ...requireAdmin, auth.me);
  return router;
}
