// POST /api/auth/login (Requirements 5.1, 5.3, 5.8, 5.10) and GET /api/auth/me (6.1).
import { UnauthorizedError } from '../utils/errors.js';
import { ok } from '../utils/response.js';

/** @param {{ authService: ReturnType<import('../services/authService.js').createAuthService> }} deps */
export function createAuthController({ authService }) {
  return {
    async login(req, res, next) {
      try {
        const { email, password } = req.valid.body;
        const { token, admin } = await authService.login(email, password);
        // Only these fields are sent: never password_hash or the submitted password (5.8).
        return ok(res, { token, admin: { id: admin.id, email: admin.email, role: admin.role } });
      } catch (err) {
        return next(err);
      }
    },

    /**
     * Returns the admin row as currently stored (6.1), including its stored role. `req.auth.role`
     * comes from the token and is what the Role_Guard checked; the response reports the
     * Database value instead. A row deleted after the Auth_Middleware ran gives 401.
     */
    async me(req, res, next) {
      try {
        const admin = await authService.getAdmin(req.auth.id);
        if (!admin) throw new UnauthorizedError();
        return ok(res, { id: admin.id, email: admin.email, role: admin.role });
      } catch (err) {
        return next(err);
      }
    },
  };
}
