// Profile service (Requirements 9.1, 10.1, 10.2, 10.5, 10.12).
//
// The Profile is a single row with id 1. This service only reads and updates that row; it never
// inserts one, so a missing row gives NotFoundError for both get and update (10.12).
//
// Column names in SQL come only from PROFILE_FIELDS (a fixed allow-list). Every value is a bind
// parameter (9.1). `updated_at` is set by the profile_set_updated_at trigger.
import { NotFoundError } from '../utils/errors.js';
import { PROFILE_FIELDS } from '../validators/profile.schemas.js';

const COLUMNS = PROFILE_FIELDS.join(', ');

export const SQL = Object.freeze({
  get: `SELECT ${COLUMNS} FROM profile WHERE id = 1`,
});

/** Picks exactly the ten Profile fields from a row, in response order (10.1). */
function toProfile(row) {
  return Object.fromEntries(PROFILE_FIELDS.map((key) => [key, row[key] ?? '']));
}

/**
 * Builds `UPDATE profile SET … WHERE id = 1 RETURNING …` for the submitted fields.
 * Keys outside PROFILE_FIELDS are ignored, so no input reaches the SQL text.
 * @param {Record<string, string>} fields
 * @returns {{ text: string, values: string[] } | null} null when no Profile field was submitted
 */
export function buildUpdate(fields) {
  const columns = PROFILE_FIELDS.filter((key) => Object.hasOwn(fields, key));
  if (columns.length === 0) return null;
  const assignments = columns.map((column, i) => `${column} = $${i + 1}`).join(', ');
  return {
    text: `UPDATE profile SET ${assignments} WHERE id = 1 RETURNING ${COLUMNS}`,
    values: columns.map((column) => fields[column]),
  };
}

/** @param {{ db: { query: Function } }} deps */
export function createProfileService({ db }) {
  async function get() {
    const { rows } = await db.query(SQL.get);
    if (rows.length === 0) throw new NotFoundError('Profile');
    return toProfile(rows[0]);
  }

  return Object.freeze({
    /**
     * @returns {Promise<Record<string, string>>} the ten Profile fields
     * @throws {NotFoundError} when the Profile row does not exist
     */
    get,

    /**
     * Updates the submitted fields in one statement and leaves omitted fields unchanged (10.2).
     * @param {Record<string, string>} fields normalized `profileBody` value (already trimmed)
     * @returns {Promise<Record<string, string>>} the ten Profile fields as stored
     * @throws {NotFoundError} when the Profile row does not exist; no row is created
     */
    async update(fields) {
      const statement = buildUpdate(fields);
      if (statement === null) return get();
      const { rows } = await db.query(statement.text, statement.values);
      if (rows.length === 0) throw new NotFoundError('Profile');
      return toProfile(rows[0]);
    },
  });
}
