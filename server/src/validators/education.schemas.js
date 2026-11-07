// Education request schema (Requirements 17.3, 17.4).
import { int, nullable, object, optional, refine, str } from './rules.js';

export const EDUCATION_MIN_YEAR = 1950;
/** How many years after the current year a start or end year may be. */
export const EDUCATION_YEARS_AHEAD = 10;

const systemClock = { now: () => Date.now() };

/** The UTC calendar year of `clock.now()`, which may return a millisecond timestamp or a Date. */
export const currentYear = (clock) => new Date(clock.now()).getUTCFullYear();

const buildSchema = (maxYear) =>
  refine(
    object({
      institution: str({ min: 1, max: 150 }),
      qualification: str({ min: 1, max: 150 }),
      field_of_study: optional(str({ max: 150 }), { default: '' }),
      start_year: int({ min: EDUCATION_MIN_YEAR, max: maxYear }),
      end_year: optional(nullable(int({ min: EDUCATION_MIN_YEAR, max: maxYear }), { emptyAsNull: true }), {
        default: null,
      }),
      description: optional(str({ max: 5000 }), { default: '' }),
    }),
    (value) =>
      value.end_year !== null && value.end_year < value.start_year
        ? [{ field: 'end_year', reason: 'before_start', message: 'End year must not be before the start year' }]
        : null,
  );

/**
 * Builds the `POST /api/education` and `PUT /api/education/:id` body schema. The current year Y is
 * read from `clock.now()` on every call, so it is the year when the request is received (17.3).
 * - Required: `institution` 1–150, `qualification` 1–150, `start_year` int 1950..Y+10.
 * - `field_of_study` 0–150 and `description` 0–5000; omitted → '' (an Education PUT replaces every
 *   field, 17.2).
 * - `end_year`: omitted, null or '' → null; otherwise an int from 1950 to Y+10 (`type` or
 *   `out_of_range` on `end_year`) that is not less than `start_year` (`before_start`), 17.4.
 *
 * @param {{ clock?: { now: () => number | Date } }} [options]
 */
export function createEducationBody({ clock = systemClock } = {}) {
  return (value, path = '') => buildSchema(currentYear(clock) + EDUCATION_YEARS_AHEAD)(value, path);
}

/** Education body schema using the system clock. */
export const educationBody = createEducationBody();
