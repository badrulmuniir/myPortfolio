import { buildQuery, request, segment } from './apiClient.js';

/** GET /api/projects[?category=] → PublicProject[] (public) */
export const listPublic = ({ category, signal } = {}) =>
  request(`/projects${buildQuery({ category })}`, { signal });

/** GET /api/projects/:identifier → PublicProject (public). `identifier` is an id or a Slug. */
export const getPublic = (identifier, { signal } = {}) =>
  request(`/projects/${segment(identifier)}`, { signal });

/** GET /api/admin/projects → AdminProject[] (admin) */
export const listAdmin = ({ signal } = {}) => request('/admin/projects', { auth: true, signal });

/** GET /api/admin/projects/:id → AdminProject (admin) */
export const getAdmin = (id, { signal } = {}) =>
  request(`/admin/projects/${segment(id)}`, { auth: true, signal });

/** POST /api/projects → AdminProject (admin) */
export const create = (project, { signal } = {}) =>
  request('/projects', { method: 'POST', body: project, auth: true, signal });

/** PUT /api/projects/:id → AdminProject (admin) */
export const update = (id, project, { signal } = {}) =>
  request(`/projects/${segment(id)}`, { method: 'PUT', body: project, auth: true, signal });

/** PATCH /api/projects/:id/publish → AdminProject (admin) */
export const setPublished = (id, isPublished, { signal } = {}) =>
  request(`/projects/${segment(id)}/publish`, {
    method: 'PATCH',
    body: { is_published: isPublished },
    auth: true,
    signal,
  });

/** DELETE /api/projects/:id → { id } (admin) */
export const remove = (id, { signal } = {}) =>
  request(`/projects/${segment(id)}`, { method: 'DELETE', auth: true, signal });
