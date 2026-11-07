// Contact endpoints (Requirements 8.4, 18.1, 18.3, 18.5, 18.6, 19.1–19.4, 19.8). No SQL here (1.5).
import { ok } from '../utils/response.js';
import { isHoneypotFilled } from '../validators/contact.schemas.js';

/**
 * The data of every successful contact submission, stored or discarded. Both paths send exactly
 * `{ success: true, data: { received: true } }` with status 201, so a bot cannot tell them
 * apart (8.4, 18.1). The new message id is never returned.
 */
export const CONTACT_RECEIVED = Object.freeze({ received: true });

const sendReceived = (res) => ok(res, { ...CONTACT_RECEIVED }, 201);

/** @param {{ contactService: ReturnType<import('../services/contactService.js').createContactService> }} deps */
export function createContactController({ contactService }) {
  return {
    /**
     * Runs before validation: a filled Honeypot_Field gets the normal 201 response whatever the
     * other fields contain, and nothing is stored (8.4). Otherwise the request continues.
     */
    discardHoneypot(req, res, next) {
      if (isHoneypotFilled(req.body)) return sendReceived(res);
      return next();
    },

    /** Stores the sanitized, validated message from `req.valid.body`. */
    async submit(req, res, next) {
      try {
        await contactService.submit(req.valid.body);
        return sendReceived(res);
      } catch (err) {
        return next(err);
      }
    },

    /** GET /api/contact: one page with `meta { total, page, limit }` (19.1, 19.2). */
    async list(req, res, next) {
      try {
        const { page, limit, is_read: isRead } = req.valid.query;
        const { items, meta } = await contactService.list({ page, limit, isRead });
        return ok(res, items, 200, meta);
      } catch (err) {
        return next(err);
      }
    },

    /** GET /api/contact/:id: read status unchanged (19.3). */
    async get(req, res, next) {
      try {
        return ok(res, await contactService.get(req.valid.params.id));
      } catch (err) {
        return next(err);
      }
    },

    /** PATCH /api/contact/:id/read (19.4). */
    async setRead(req, res, next) {
      try {
        return ok(res, await contactService.setRead(req.valid.params.id, req.valid.body.is_read));
      } catch (err) {
        return next(err);
      }
    },

    /** DELETE /api/contact/:id → `{ id }` (19.8). */
    async remove(req, res, next) {
      try {
        return ok(res, await contactService.remove(req.valid.params.id));
      } catch (err) {
        return next(err);
      }
    },
  };
}
