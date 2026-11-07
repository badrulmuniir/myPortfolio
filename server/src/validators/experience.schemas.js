// Experience request schema (Requirements 16.3, 16.4, 16.5, 16.6, 16.8).
import { EMPLOYMENT_TYPES, isoDate, list, nullable, object, oneOf, optional, refine, str } from './rules.js';

export const RESPONSIBILITIES_MAX = 20;

const experienceShape = object({
  job_title: str({ min: 1, max: 100 }),
  company_name: str({ min: 1, max: 100 }),
  employment_type: oneOf(EMPLOYMENT_TYPES),
  start_date: isoDate(),
  end_date: optional(nullable(isoDate(), { emptyAsNull: true })),
  description: str({ max: 5000, required: false }),
  responsibilities: optional(list(str({ min: 1, max: 300 }), { max: RESPONSIBILITIES_MAX })),
});

/**
 * `POST /api/experiences` and `PUT /api/experiences/:id` body.
 * - Required: `job_title` 1–100, `company_name` 1–100, `employment_type`, `start_date` (YYYY-MM-DD).
 * - `end_date`: omitted, null, '' (→ null) or a real date not earlier than `start_date`; an earlier
 *   date fails with `before_start` on `end_date` (16.5).
 * - `description` 0–5000 and `responsibilities` (0–20 items of 1–300) are optional.
 *
 * Omitted optional fields stay `undefined` (left out of the normalized body): an Experience PUT
 * keeps them unchanged (accepted design decision), and a create uses the column defaults.
 * The end-date check here only compares submitted values; when a PUT omits `end_date`, the stored
 * end date is checked by the Database constraint.
 */
export const experienceBody = refine(experienceShape, (value) =>
  typeof value.end_date === 'string' && value.end_date < value.start_date
    ? [{ field: 'end_date', reason: 'before_start', message: 'End date must not be before the start date' }]
    : null,
);
