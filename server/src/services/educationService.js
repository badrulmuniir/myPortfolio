// Education_Record storage (Requirements 17.1, 17.2, 17.5, 17.6). All education SQL lives here.
// Every statement is parameterized and writes return the stored row with RETURNING.
import { NotFoundError } from '../utils/errors.js';

const COLUMNS = 'id, institution, qualification, field_of_study, start_year, end_year, description';

/** SQL text, exported so unit tests can recognize each statement in a fake db. */
export const SQL = Object.freeze({
  // 17.1: start year descending, then end year descending with "no end year" first, then id.
  list: `SELECT ${COLUMNS} FROM education ORDER BY start_year DESC, end_year DESC NULLS FIRST, id ASC`,
  create: `INSERT INTO education (institution, qualification, field_of_study, start_year, end_year, description)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING ${COLUMNS}`,
  // 17.2: an Education PUT replaces every field.
  update: `UPDATE education
SET institution = $2, qualification = $3, field_of_study = $4, start_year = $5, end_year = $6, description = $7
WHERE id = $1
RETURNING ${COLUMNS}`,
  remove: 'DELETE FROM education WHERE id = $1 RETURNING id',
});

/** Maps a row to the Education API shape (exactly these seven keys). */
function toEducation(row) {
  return {
    id: row.id,
    institution: row.institution,
    qualification: row.qualification,
    field_of_study: row.field_of_study,
    start_year: row.start_year,
    end_year: row.end_year ?? null,
    description: row.description,
  };
}

/** Bind values in column order, from a body already normalized by `educationBody`. */
const fieldValues = (input) => [
  input.institution,
  input.qualification,
  input.field_of_study ?? '',
  input.start_year,
  input.end_year ?? null,
  input.description ?? '',
];

/** @param {{ db: { query: (text: string, params?: unknown[]) => Promise<{ rows: object[] }> } }} deps */
export function createEducationService({ db }) {
  return {
    /** Every Education_Record in the documented order; [] when there are none. */
    async list() {
      const { rows } = await db.query(SQL.list);
      return rows.map(toEducation);
    },

    async create(input) {
      const { rows } = await db.query(SQL.create, fieldValues(input));
      return toEducation(rows[0]);
    },

    /** Replaces all fields. Throws NotFoundError when no record has this id. */
    async update(id, input) {
      const { rows } = await db.query(SQL.update, [id, ...fieldValues(input)]);
      if (rows.length === 0) throw new NotFoundError('Education');
      return toEducation(rows[0]);
    },

    /** Deletes the record and returns `{ id }`. Throws NotFoundError when no record has this id. */
    async remove(id) {
      const { rows } = await db.query(SQL.remove, [id]);
      if (rows.length === 0) throw new NotFoundError('Education');
      return { id: rows[0].id };
    },
  };
}
