import { request, segment } from './apiClient.js';

/** GET /api/skills → Skill[] (public) */
export const list = ({ signal } = {}) => request('/skills', { signal });

/** POST /api/skills → Skill (admin) */
export const create = (skill, { signal } = {}) =>
  request('/skills', { method: 'POST', body: skill, auth: true, signal });

/** PUT /api/skills/:id → Skill (admin) */
export const update = (id, skill, { signal } = {}) =>
  request(`/skills/${segment(id)}`, { method: 'PUT', body: skill, auth: true, signal });

/** DELETE /api/skills/:id → { id } (admin) */
export const remove = (id, { signal } = {}) =>
  request(`/skills/${segment(id)}`, { method: 'DELETE', auth: true, signal });
