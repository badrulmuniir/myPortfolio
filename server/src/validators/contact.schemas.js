// Contact request schemas (Requirements 8.4, 18.2, 18.3, 18.4, 18.5, 19.10, 19.11).
import { bool, digits, email, isPlainObject, map, object, oneOf, optional, pass, str } from './rules.js';
import { sanitizeText } from '../utils/sanitize.js';

/** Name of the Honeypot_Field in the contact form and request body. */
export const HONEYPOT_FIELD = 'website';

/** The four contact fields that are sanitized, validated and stored. */
export const CONTACT_FIELDS = Object.freeze(['name', 'email', 'subject', 'message']);

/**
 * True when a contact body carries a filled Honeypot_Field (8.4): a string of at least one
 * character (whitespace included), or any other non-null value, which no person can enter through
 * the form. Absent, null and '' count as empty. A body that is not a plain object has no honeypot.
 * The controller checks this before validation, because a filled honeypot returns 201 whatever the
 * other fields contain.
 */
export function isHoneypotFilled(body) {
  if (!isPlainObject(body) || !Object.hasOwn(body, HONEYPOT_FIELD)) return false;
  const value = body[HONEYPOT_FIELD];
  if (value === undefined || value === null) return false;
  return typeof value === 'string' ? value.length > 0 : true;
}

const contactShape = object(
  {
    name: str({ min: 1, max: 100 }),
    email: email(),
    subject: str({ min: 1, max: 150 }),
    message: str({ min: 10, max: 5000 }),
    // Passed through unchanged and never validated; see isHoneypotFilled.
    [HONEYPOT_FIELD]: (value) => pass(value),
  },
  { unknown: 'strip' },
);

/**
 * `POST /api/contact` body. A plain object is required (`required` when absent, `type` otherwise).
 * Each of the four contact fields is sanitized with `sanitizeText` (control characters removed,
 * then trimmed) before the rules run, so lengths are counted in code points after sanitizing
 * (18.2, 18.4): `name` 1–100, `email` Valid_Email, `subject` 1–150, `message` 10–5000.
 * Unknown keys such as `id`, `is_read` or `created_at` are dropped (18.5). The normalized value
 * holds the four sanitized fields, plus `website` when it was sent.
 */
export function contactBody(value, path = '') {
  if (!isPlainObject(value)) return contactShape(value, path);
  const sanitized = { ...value };
  for (const field of CONTACT_FIELDS) {
    if (Object.hasOwn(value, field)) sanitized[field] = sanitizeText(value[field]);
  }
  return contactShape(sanitized, path);
}

/** Largest accepted `page`; larger values are outside the safe-integer range of an OFFSET. */
export const CONTACT_PAGE_MAX = Number.MAX_SAFE_INTEGER;

/**
 * `GET /api/contact` query (19.1, 19.2, 19.10).
 * - `page`: digits only, ≥ 1, default 1.
 * - `limit`: digits only, 1–100, default 20.
 * - `is_read`: optional, exactly 'true' or 'false', converted to a boolean.
 * A repeated parameter arrives as an array and fails with `type`. Unknown query parameters are
 * ignored (same policy as `publicProjectQuery`; 9.6 covers bodies).
 */
export const contactListQuery = object(
  {
    page: optional(digits({ min: 1, max: CONTACT_PAGE_MAX }), { default: 1 }),
    limit: optional(digits({ min: 1, max: 100 }), { default: 20 }),
    is_read: optional(map(oneOf(['true', 'false']), (v) => v === 'true')),
  },
  { unknown: 'strip' },
);

/** `PATCH /api/contact/:id/read` body: a JSON boolean `is_read`, required; "true" fails (19.11). */
export const readBody = object({
  is_read: bool(),
});
