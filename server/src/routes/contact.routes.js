// Contact routes (Requirements 8.2, 8.3, 8.4, 18.1–18.6, 19.1–19.4, 19.8, 19.10, 19.11).
// - POST /api/contact is public and never reads the Authorization header. Order:
//   contact Rate_Limiter → honeypot check → validate (sanitizes, strips unknown keys) → store.
//   A blocked IP gets 429 before its message is validated or stored (8.2). A filled honeypot
//   gets 201 before validation, whatever the other fields contain (8.4).
// - GET /api/contact, GET /api/contact/:id, PATCH /api/contact/:id/read and
//   DELETE /api/contact/:id are admin-only; `requireAdmin` runs before `validate` (7.8).
import { Router } from 'express';
import { createContactController } from '../controllers/contact.controller.js';
import { adminOnly } from '../middleware/auth.js';
import { contactRateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { createContactService } from '../services/contactService.js';
import { createContactLimiter } from '../utils/rateLimiter.js';
import { contactBody, contactListQuery, readBody } from '../validators/contact.schemas.js';
import { idParams } from '../validators/params.schemas.js';

/**
 * @param {{ db: object, config: object, clock?: object, logger?: object,
 *   requireAdmin?: ReadonlyArray<import('express').RequestHandler>,
 *   contactLimiter?: ReturnType<typeof createContactLimiter> }} deps
 *   `requireAdmin` is the shared [authenticate, requireRole('admin')] pair and `contactLimiter`
 *   the per-app contact Rate_Limiter from routes/index.js; both are built here only when the
 *   router is created on its own.
 */
export function createContactRouter({
  db,
  config,
  clock,
  requireAdmin = adminOnly({ db, config, clock }),
  contactLimiter = createContactLimiter({ clock }),
}) {
  const router = Router();
  const contact = createContactController({ contactService: createContactService({ db }) });
  router.post(
    '/contact',
    contactRateLimit(contactLimiter),
    contact.discardHoneypot,
    validate({ body: contactBody }),
    contact.submit,
  );
  router.get('/contact', ...requireAdmin, validate({ query: contactListQuery }), contact.list);
  router.get('/contact/:id', ...requireAdmin, validate({ params: idParams }), contact.get);
  router.patch('/contact/:id/read', ...requireAdmin, validate({ params: idParams, body: readBody }), contact.setRead);
  router.delete('/contact/:id', ...requireAdmin, validate({ params: idParams }), contact.remove);
  return router;
}
