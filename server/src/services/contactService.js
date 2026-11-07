// Contact messages (Requirements 18.1, 18.5, 18.6, 19.1–19.4, 19.8).
//
// All SQL for the contact_messages table lives here. Every statement is parameterized.
// `id`, `is_read` and `created_at` always come from the column defaults (identity, false, now()),
// never from the request (18.5).
import { NotFoundError } from '../utils/errors.js';

const COLUMNS = 'id, name, email, subject, message, is_read, created_at';

/** `$1` is the optional read-status filter: null matches every message (19.2). */
const FILTER = '($1::boolean IS NULL OR is_read = $1)';

export const SQL = Object.freeze({
  // One statement, so a failure stores nothing (18.6).
  submit: `INSERT INTO contact_messages (name, email, subject, message)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
  // 19.1, 19.2: one page plus the filtered total in a single statement, so both come from the
  // same snapshot. The count side always yields one row; the LEFT JOIN keeps it when the page is
  // empty (page beyond the last page, or no matching messages), and the message columns are then
  // null. $2 = limit, $3 = offset as a bigint (see `offsetFor`).
  list: `SELECT c.total, m.id, m.name, m.email, m.subject, m.message, m.is_read, m.created_at
FROM (SELECT count(*)::int AS total FROM contact_messages WHERE ${FILTER}) c
LEFT JOIN (
  SELECT ${COLUMNS}
  FROM contact_messages
  WHERE ${FILTER}
  ORDER BY created_at DESC, id DESC
  LIMIT $2 OFFSET $3::bigint
) m ON true
ORDER BY m.created_at DESC, m.id DESC`,
  // 19.3: a plain read; it never changes is_read.
  get: `SELECT ${COLUMNS} FROM contact_messages WHERE id = $1`,
  // 19.4: only is_read changes; setting the current value again also succeeds.
  setRead: `UPDATE contact_messages SET is_read = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
  // 19.8
  remove: 'DELETE FROM contact_messages WHERE id = $1 RETURNING id',
});

/**
 * OFFSET for a page, as a decimal string bound to a bigint parameter.
 * `contactListQuery` caps `page` at Number.MAX_SAFE_INTEGER and `limit` at 100, so
 * (page − 1) × limit can exceed MAX_SAFE_INTEGER, where Number arithmetic loses precision. BigInt
 * keeps it exact, and the largest value (≈ 9.0 × 10^17) fits in a PostgreSQL bigint
 * (≈ 9.2 × 10^18). An offset past the last row simply returns no rows, so a huge page is not
 * rejected or clamped: it gets `data: []` with the correct total.
 */
export function offsetFor(page, limit) {
  return ((BigInt(page) - 1n) * BigInt(limit)).toString();
}

const toIso = (value) => (value instanceof Date ? value.toISOString() : value);

/** Maps a row to the ContactMessage API shape (exactly these seven keys). */
function toMessage(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    subject: row.subject,
    message: row.message,
    is_read: row.is_read,
    created_at: toIso(row.created_at),
  };
}

/**
 * @typedef {{ name: string, email: string, subject: string, message: string }} ContactInput
 *   sanitized and validated values from the `contactBody` schema
 * @typedef {{ id: number, name: string, email: string, subject: string, message: string,
 *   is_read: boolean, created_at: string }} ContactMessage
 */

/** @param {{ db: { query: Function } }} deps */
export function createContactService({ db }) {
  return Object.freeze({
    /**
     * Stores one Contact_Message. Only the four contact fields are read from `input`.
     * @param {ContactInput} input
     * @returns {Promise<{ id: number }>}
     */
    async submit({ name, email, subject, message }) {
      const { rows } = await db.query(SQL.submit, [name, email, subject, message]);
      return { id: rows[0].id };
    },

    /**
     * One page of Contact_Messages, newest first (ties by id descending), and the total number
     * of messages matching the filter.
     * @param {{ page: number, limit: number, isRead?: boolean }} options values from `contactListQuery`
     * @returns {Promise<{ items: ContactMessage[], meta: { total: number, page: number, limit: number } }>}
     */
    async list({ page, limit, isRead }) {
      const { rows } = await db.query(SQL.list, [isRead ?? null, limit, offsetFor(page, limit)]);
      const total = rows[0]?.total ?? 0;
      const items = rows.filter((r) => r.id !== null && r.id !== undefined).map(toMessage);
      return { items, meta: { total, page, limit } };
    },

    /** Reads one message without side effects. Throws NotFoundError when no message has this id. */
    async get(id) {
      const { rows } = await db.query(SQL.get, [id]);
      if (rows.length === 0) throw new NotFoundError('Message');
      return toMessage(rows[0]);
    },

    /** Sets is_read and returns the updated message. Throws NotFoundError when it is missing. */
    async setRead(id, value) {
      const { rows } = await db.query(SQL.setRead, [id, value]);
      if (rows.length === 0) throw new NotFoundError('Message');
      return toMessage(rows[0]);
    },

    /** Permanently deletes the message and returns `{ id }`. Throws NotFoundError when it is missing. */
    async remove(id) {
      const { rows } = await db.query(SQL.remove, [id]);
      if (rows.length === 0) throw new NotFoundError('Message');
      return { id: rows[0].id };
    },
  });
}
