import { request } from './apiClient.js';

/** GET /api/profile → Profile (public) */
export const get = ({ signal } = {}) => request('/profile', { signal });

/** PUT /api/profile → Profile (admin) */
export const update = (profile, { signal } = {}) =>
  request('/profile', { method: 'PUT', body: profile, auth: true, signal });
