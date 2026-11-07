// Parses JWT_EXPIRES_IN into a whole number of seconds (Requirements 5.7, 5.9).
// A bare number means seconds. jsonwebtoken would read a unit-less string as milliseconds,
// so the API_Server always passes it the number this function returns.

export const DEFAULT_JWT_EXPIRES_IN_SECONDS = 7200; // 2 hours

const DURATION_RE = /^([0-9]+)([smhd]?)$/;
const UNIT_SECONDS = { '': 1, s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Parses a duration such as `120`, `90s`, `15m`, `2h` or `7d` into seconds.
 * Returns `null` when the value is not a positive whole number with an optional unit,
 * or when the result is too large to be represented exactly.
 * @param {string} value
 * @returns {number | null}
 */
export function parseDurationSeconds(value) {
  if (typeof value !== 'string') return null;
  const match = DURATION_RE.exec(value);
  if (!match) return null;
  const seconds = Number(match[1]) * UNIT_SECONDS[match[2]];
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  return seconds;
}
