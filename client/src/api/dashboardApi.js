import { request } from './apiClient.js';

/** GET /api/dashboard/stats → DashboardStats (admin) */
export const stats = ({ signal } = {}) => request('/dashboard/stats', { auth: true, signal });
