import { buildQuery, request, requestWithMeta, segment } from './apiClient.js';

/**
 * POST /api/contact → { received: true } (public, never carries the token)
 * `message` is { name, email, subject, message, website }; `website` is the honeypot.
 */
export const submit = (message, { signal } = {}) =>
  request('/contact', { method: 'POST', body: message, signal });

/**
 * GET /api/contact[?page&limit&is_read] → { data: ContactMessage[], meta: { total, page, limit } } (admin)
 * Unset parameters are omitted, so the server defaults apply.
 */
export const list = ({ page, limit, isRead, signal } = {}) =>
  requestWithMeta(`/contact${buildQuery({ page, limit, is_read: isRead })}`, {
    auth: true,
    signal,
  });

/** GET /api/contact/:id → ContactMessage (admin). Does not change the read state. */
export const get = (id, { signal } = {}) =>
  request(`/contact/${segment(id)}`, { auth: true, signal });

/** PATCH /api/contact/:id/read → ContactMessage (admin) */
export const setRead = (id, isRead, { signal } = {}) =>
  request(`/contact/${segment(id)}/read`, {
    method: 'PATCH',
    body: { is_read: isRead },
    auth: true,
    signal,
  });

/** DELETE /api/contact/:id → { id } (admin) */
export const remove = (id, { signal } = {}) =>
  request(`/contact/${segment(id)}`, { method: 'DELETE', auth: true, signal });
