// Slug_Generator (Requirements 13.10, 13.11, 13.12, 13.14).
//
// A Slug matches SLUG_RE, is at most SLUG_MAX characters long and contains at least one
// letter, so that a Project_Identifier made only of digits is always an id (assumption A1).

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 160;

const HAS_LETTER = /[a-z]/;
const FALLBACK = 'project';

/**
 * True when `s` is a string that matches the Slug definition. Non-strings return false.
 * The length check runs before the regular expression, so oversized input is rejected cheaply.
 */
export function isSlug(s) {
  return typeof s === 'string' && s.length <= SLUG_MAX && SLUG_RE.test(s) && HAS_LETTER.test(s);
}

/**
 * Criterion 13.10 steps 1-3: lowercase, replace each run of characters other than a-z and 0-9
 * with one hyphen, trim leading and trailing hyphens. Non-ASCII letters (for example "é" or the
 * combining dot that "İ".toLowerCase() produces) are not in a-z, so they become separators.
 * The result is either '' or matches SLUG_RE.
 */
export function slugify(title) {
  if (typeof title !== 'string') throw new TypeError('slugify expects a string title');
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Shortens a slug-shaped string (output of slugify) to at most `max` characters. It cuts at the
 * last hyphen inside the limit unless the limit already falls on a hyphen boundary, and never
 * returns a string ending with '-'. Input without hyphens inside the limit is cut at `max`.
 */
export function truncate(s, max) {
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  if (s[max] !== '-' && cut.includes('-')) cut = cut.slice(0, cut.lastIndexOf('-'));
  return cut.replace(/-+$/, '');
}

/**
 * Criteria 13.10 and 13.12 without the uniqueness suffix. `max` is the room available for the
 * result (SLUG_MAX minus any suffix length). Truncation runs before the letter check so a title
 * whose only letter falls beyond the limit still gets the `project-` prefix.
 *
 * Applying this to any valid Slug returns it unchanged (13.14).
 */
export function deriveSlug(title, max = SLUG_MAX) {
  if (!Number.isInteger(max) || max < 1 || max > SLUG_MAX) {
    throw new RangeError(`deriveSlug max must be an integer from 1 to ${SLUG_MAX}`);
  }
  const s = truncate(slugify(title), max);
  // Slice the fallback too, so the result never exceeds `max` even for a tiny limit.
  if (s === '') return FALLBACK.slice(0, max);
  if (HAS_LETTER.test(s)) return s;
  // "project-" + digits may exceed max; truncate keeps the "project" prefix, so the result
  // always contains a letter (it may drop the digits entirely when they do not fit).
  return truncate(`${FALLBACK}-${s}`, max);
}

/**
 * Criterion 13.11: the derived Slug, or the derived Slug with the smallest suffix -2, -3, ...
 * that is not in `taken`. The base is derived against SLUG_MAX minus the suffix length, so every
 * candidate is a valid Slug of at most SLUG_MAX characters.
 *
 * Termination: for k >= 2 the last hyphen-separated segment of a candidate is the decimal k, so
 * those candidates are pairwise distinct. At most taken.size + 2 candidates are tried.
 *
 * @param {string} title
 * @param {Set<string> | Iterable<string>} taken Slugs that already belong to other Projects.
 */
export function generateUniqueSlug(title, taken = new Set()) {
  const used = taken instanceof Set ? taken : new Set(taken);
  for (let k = 1; ; k++) {
    const suffix = k === 1 ? '' : `-${k}`;
    const candidate = deriveSlug(title, SLUG_MAX - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
}
