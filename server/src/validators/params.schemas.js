// Path parameter schema (Requirement 4.10).
import { digits, object } from './rules.js';

/** Largest id: the PostgreSQL INTEGER maximum. */
export const ID_MAX = 2147483647;

/**
 * `:id` path parameter: ASCII digits only (no sign, decimal point or whitespace), value 1..ID_MAX.
 * Leading zeros are accepted ('007' → 7). Other router params are ignored. A failure is turned
 * into a 400 INVALID_ID by the `validate` middleware.
 */
export const idParams = object(
  {
    id: digits({ min: 1, max: ID_MAX }),
  },
  { unknown: 'strip' },
);
