import { request } from './apiClient.js';

/**
 * POST /api/auth/login → { token, admin: { id, email, role } }
 * Public. A 401 here means invalid credentials, so the unauthorized handler is skipped.
 */
export const login = ({ email, password }, { signal } = {}) =>
  request('/auth/login', {
    method: 'POST',
    body: { email, password },
    signal,
    skipUnauthorizedHandler: true,
  });

/**
 * GET /api/auth/me → { id, email, role }
 * The bootstrap check passes skipUnauthorizedHandler: true and handles 401 itself (6.2, 6.7).
 */
export const me = ({ signal, skipUnauthorizedHandler = false } = {}) =>
  request('/auth/me', { auth: true, signal, skipUnauthorizedHandler });
