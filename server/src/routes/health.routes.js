// Public health endpoint: GET /api/health (Requirements 36.8, 36.9). No authentication.
import { Router } from 'express';
import { createHealthController } from '../controllers/health.controller.js';

/** @param {{ db: { healthCheck: () => Promise<boolean> } }} deps */
export function createHealthRouter({ db }) {
  const router = Router();
  const health = createHealthController({ db });
  router.get('/health', health.check);
  return router;
}
