import { request } from './apiClient.js';

/** GET /api/health → { status: 'ok' } */
export const getHealth = ({ signal } = {}) => request('/health', { signal });
