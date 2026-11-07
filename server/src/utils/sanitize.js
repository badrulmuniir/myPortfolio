// Contact sanitizing (Requirement 18.4).
//
// Removes the C0 control characters U+0000–U+0008, U+000B, U+000C, U+000E–U+001F and DEL
// (U+007F). Tab (U+0009), line feed (U+000A) and carriage return (U+000D) are kept so that
// multi-line messages survive. Nothing else is removed: C1 controls (U+0080–U+009F), zero-width
// characters and HTML stay as submitted, because the Frontend renders text as plain text.
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Removes the disallowed control characters, then trims leading and trailing whitespace.
 *
 * Trimming uses `String.prototype.trim`, so it removes Unicode whitespace at the edges
 * (including tabs, line feeds and carriage returns there); whitespace inside the text is kept.
 * Removal runs first, so whitespace hidden behind a control character is also trimmed
 * (`'\u0000  hi  '` becomes `'hi'`).
 *
 * Non-string input is returned unchanged, so the Validator can report it with its `type` rule
 * instead of the value being coerced to a string here.
 *
 * @param {unknown} value
 * @returns {unknown} the sanitized string, or `value` itself when it is not a string
 */
export function sanitizeText(value) {
  if (typeof value !== 'string') return value;
  return value.replace(DISALLOWED_CONTROL, '').trim();
}
