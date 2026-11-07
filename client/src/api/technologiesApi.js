import { request } from './apiClient.js';

/** GET /api/technologies → Technology[] (admin) */
export const list = ({ signal } = {}) => request('/technologies', { auth: true, signal });
