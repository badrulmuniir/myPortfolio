// Experience service (Requirements 9.1, 16.1, 16.2, 16.5, 16.6, 16.9, 16.10).
//
// Column names in SQL come only from EXPERIENCE_FIELDS (a fixed allow-list); every value is a
// bind parameter (9.1). `responsibilities` is sent as a JS array cast to `text[]`; `start_date`
// and `end_date` are 'YYYY-MM-DD' strings both ways (the DATE type parser in db/typeParsers.js
// returns strings). `updated_at` is set by the experiences_set_updated_at trigger.
//
// PUT semantics (accepted design decision): submitted fields replace the stored ones, including
// the whole responsibilities list; omitted optional fields keep their stored values (16.2).
import { NotFoundError, ValidationError } from '../utils/errors.js';

/** Writable columns, in response order after `id`. */
export const EXPERIENCE_FIELDS = Object.freeze([
  'job_title',
  'company_name',
  'employment_type',
  'start_date',
  'end_date',
  'description',
  'responsibilities',
]);

/** Name of the CHECK constraint `end_date IS NULL OR end_date >= start_date` (migration 007). */
export const END_AFTER_START_CONSTRAINT = 'experiences_end_after_start';

/** PostgreSQL check_violation. */
const PG_CHECK_VIOLATION = '23514';

const COLUMNS = ['id', ...EXPERIENCE_FIELDS].join(', ');

/** Placeholder casts so pg sends each value with the column's type. */
const CASTS = Object.freeze({ start_date: '::date', end_date: '::date', responsibilities: '::text[]' });

export const SQL = Object.freeze({
  list: `SELECT ${COLUMNS} FROM experiences ORDER BY start_date DESC, id DESC`,
  lockById: 'SELECT id, start_date, end_date FROM experiences WHERE id = $1 FOR UPDATE',
  getById: `SELECT ${COLUMNS} FROM experiences WHERE id = $1`,
  remove: 'DELETE FROM experiences WHERE id = $1 RETURNING id',
});

const BEFORE_START = Object.freeze({
  field: 'end_date',
  reason: 'before_start',
  message: 'End date must not be before the start date',
});

const beforeStartError = () => new ValidationError([{ ...BEFORE_START }]);

/** Maps a row to the Experience shape. */
function toExperience(row) {
  return {
    id: row.id,
    job_title: row.job_title,
    company_name: row.company_name,
    employment_type: row.employment_type,
    start_date: row.start_date,
    end_date: row.end_date ?? null,
    description: row.description ?? '',
    responsibilities: row.responsibilities ?? [],
  };
}

/** Allow-listed columns present in `fields` (a value of `undefined` means "omitted"). */
const submittedColumns = (fields) => EXPERIENCE_FIELDS.filter((key) => fields[key] !== undefined);

const valueOf = (fields, column) => (column === 'responsibilities' ? [...fields[column]] : fields[column]);

/**
 * Builds `INSERT INTO experiences (…) VALUES (…) RETURNING …` for the submitted fields.
 * Omitted optional columns take their defaults ('' description, '{}' responsibilities, NULL end).
 * @param {Record<string, unknown>} fields normalized `experienceBody` value
 */
export function buildInsert(fields) {
  const columns = submittedColumns(fields);
  const placeholders = columns.map((column, i) => `$${i + 1}${CASTS[column] ?? ''}`);
  return {
    text: `INSERT INTO experiences (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${COLUMNS}`,
    values: columns.map((column) => valueOf(fields, column)),
  };
}

/**
 * Builds `UPDATE experiences SET … WHERE id = $1 RETURNING …` for the submitted fields only.
 * @param {number} id
 * @param {Record<string, unknown>} fields normalized `experienceBody` value
 * @returns {{ text: string, values: unknown[] } | null} null when no field was submitted
 */
export function buildUpdate(id, fields) {
  const columns = submittedColumns(fields);
  if (columns.length === 0) return null;
  const assignments = columns.map((column, i) => `${column} = $${i + 2}${CASTS[column] ?? ''}`);
  return {
    text: `UPDATE experiences SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`,
    values: [id, ...columns.map((column) => valueOf(fields, column))],
  };
}

/**
 * True when the end date that would be stored is earlier than the start date that would be
 * stored. Both are 'YYYY-MM-DD' strings, so string order equals date order.
 */
export function endsBeforeStart(start, end) {
  return typeof start === 'string' && typeof end === 'string' && end < start;
}

/** A CHECK violation of the end-date constraint: the Database's safety net for 16.5. */
function isEndBeforeStartViolation(err) {
  return err?.code === PG_CHECK_VIOLATION && err?.constraint === END_AFTER_START_CONSTRAINT;
}

async function mapCheckViolation(work) {
  try {
    return await work();
  } catch (err) {
    if (isEndBeforeStartViolation(err)) throw beforeStartError();
    throw err;
  }
}

/** @param {{ db: { query: Function, withTransaction: Function } }} deps */
export function createExperienceService({ db }) {
  return Object.freeze({
    /** All Experience_Records, newest start date first, then id descending (16.1). */
    async list() {
      const { rows } = await db.query(SQL.list);
      return rows.map(toExperience);
    },

    /**
     * Inserts one record (16.2).
     * @param {Record<string, unknown>} fields normalized `experienceBody` value
     * @throws {ValidationError} end date before start date (Database check as a safety net)
     */
    async create(fields) {
      const statement = buildInsert(fields);
      const { rows } = await mapCheckViolation(() => db.query(statement.text, statement.values));
      return toExperience(rows[0]);
    },

    /**
     * Replaces the submitted fields and keeps omitted optional fields (16.2). Runs in one
     * transaction: the row is locked, then the end date that would be stored is compared with the
     * start date that would be stored, so a PUT with only one of the two dates is checked against
     * the stored other date (16.5). No write happens when the check fails.
     * @param {number} id
     * @param {Record<string, unknown>} fields normalized `experienceBody` value
     * @throws {NotFoundError} no record has this id (16.10)
     * @throws {ValidationError} end date before start date (16.5)
     */
    async update(id, fields) {
      return mapCheckViolation(() =>
        db.withTransaction(async (tx) => {
          const { rows: current } = await tx.query(SQL.lockById, [id]);
          if (current.length === 0) throw new NotFoundError('Experience');

          const start = fields.start_date !== undefined ? fields.start_date : current[0].start_date;
          const end = fields.end_date !== undefined ? fields.end_date : current[0].end_date;
          if (endsBeforeStart(start, end)) throw beforeStartError();

          const statement = buildUpdate(id, fields);
          const { rows } = statement
            ? await tx.query(statement.text, statement.values)
            : await tx.query(SQL.getById, [id]);
          return toExperience(rows[0]);
        }),
      );
    },

    /**
     * Deletes one record (16.9).
     * @param {number} id
     * @returns {Promise<{ id: number }>}
     * @throws {NotFoundError} no record has this id (16.10)
     */
    async remove(id) {
      const { rows } = await db.query(SQL.remove, [id]);
      if (rows.length === 0) throw new NotFoundError('Experience');
      return { id: rows[0].id };
    },
  });
}
