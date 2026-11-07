import { request, segment } from './apiClient.js';

/** GET /api/education → Education[] (public) */
export const list = ({ signal } = {}) => request('/education', { signal });

/** POST /api/education → Education (admin) */
export const create = (education, { signal } = {}) =>
  request('/education', { method: 'POST', body: education, auth: true, signal });

/** PUT /api/education/:id → Education (admin) */
export const update = (id, education, { signal } = {}) =>
  request(`/education/${segment(id)}`, { method: 'PUT', body: education, auth: true, signal });

/** DELETE /api/education/:id → { id } (admin) */
export const remove = (id, { signal } = {}) =>
  request(`/education/${segment(id)}`, { method: 'DELETE', auth: true, signal });
