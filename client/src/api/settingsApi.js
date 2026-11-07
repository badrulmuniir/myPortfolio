import { request } from './apiClient.js';

/** GET /api/settings → Settings (public) */
export const get = ({ signal } = {}) => request('/settings', { signal });

/** PUT /api/settings → Settings (admin). `settings` holds any non-empty subset of the four keys. */
export const update = (settings, { signal } = {}) =>
  request('/settings', { method: 'PUT', body: settings, auth: true, signal });
