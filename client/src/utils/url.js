// Valid_URL check for the Frontend (Requirement 9.7, design "Validator" shared definitions).
//
// This is a copy of `isValidUrl` in server/src/validators/rules.js. The client does not import
// server code, so the rule and its constant are repeated here and must stay identical.

/** Longest accepted URL, in Unicode code points. */
export const URL_MAX_LENGTH = 2048;

/**
 * True when `value` is a Valid_URL: a string of at most 2048 code points for which `new URL()`
 * succeeds, whose protocol is `http:` or `https:` and whose hostname is not empty.
 * The value is not trimmed here; form validators trim before calling it.
 * `javascript:`, `data:`, `mailto:` and relative URLs return false.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidUrl(value) {
  if (typeof value !== 'string' || [...value].length > URL_MAX_LENGTH) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
}
