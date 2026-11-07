import { request, segment } from './apiClient.js';

/** GET /api/experiences → Experience[] (public) */
export const list = ({ signal } = {}) => request('/experiences', { signal });

/** POST /api/experiences → Experience (admin) */
export const create = (experience, { signal } = {}) =>
  request('/experiences', { method: 'POST', body: experience, auth: true, signal });

/** PUT /api/experiences/:id → Experience (admin) */
export const update = (id, experience, { signal } = {}) =>
  request(`/experiences/${segment(id)}`, { method: 'PUT', body: experience, auth: true, signal });

/** DELETE /api/experiences/:id → { id } (admin) */
export const remove = (id, { signal } = {}) =>
  request(`/experiences/${segment(id)}`, { method: 'DELETE', auth: true, signal });
