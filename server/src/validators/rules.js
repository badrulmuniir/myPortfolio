// Validator rule primitives (design: "Validator (src/validators/)").
// Requirements 4.2, 5.4, 9.6, 10.3, 10.4, 13.7, 13.8, 15.3, 16.3, 16.4, 17.3, 18.2.
//
// A rule is a pure function `(value, path = '') => Result` where
//   Result = { ok: true, value } | { ok: false, errors: [{ field, reason, message }] }.
// `value` on success is the normalized value (strings trimmed, except passwords).
//
// Presence conventions:
// - `undefined` means the field was omitted. Every rule rejects it with `required` unless the
//   rule is wrapped in `optional(rule)` (or built with `required: false`), which accepts it and
//   yields `undefined` (or the given default). `object()` leaves `undefined` values out of its
//   output, so an omitted optional field stays omitted.
// - `null` counts as missing for every rule (`required`), unless wrapped in `nullable(rule)`.
//   `nullable(rule, { emptyAsNull: true })` also turns '' (after trimming) into null, for
//   `end_date` and `end_year`.
// - '' is a present value. `str({ min: 0 })` accepts it; `str({ min: 1 })` rejects it with
//   `required`, so a whitespace-only value counts as empty. `url({ allowEmpty: true })` accepts ''.
//
// Each rule reports at most one error per field path: the first check that fails.
// `object()` and `list()` collect the errors of every field and item.

// --- Shared definitions -------------------------------------------------------------------

/** Fixed reason tokens used in `details[].reason`. */
export const REASONS = Object.freeze({
  REQUIRED: 'required',
  TYPE: 'type',
  TOO_SHORT: 'too_short',
  TOO_LONG: 'too_long',
  OUT_OF_RANGE: 'out_of_range',
  INVALID_FORMAT: 'invalid_format',
  INVALID_URL: 'invalid_url',
  INVALID_EMAIL: 'invalid_email',
  INVALID_VALUE: 'invalid_value',
  DUPLICATE: 'duplicate',
  UNKNOWN_FIELD: 'unknown_field',
  BEFORE_START: 'before_start',
});

const DEFAULT_MESSAGES = Object.freeze({
  required: 'This field is required',
  type: 'Has the wrong type',
  too_short: 'Is too short',
  too_long: 'Is too long',
  out_of_range: 'Is out of range',
  invalid_format: 'Has an invalid format',
  invalid_url: 'Must be a valid http or https URL',
  invalid_email: 'Must be a valid email address',
  invalid_value: 'Has an invalid value',
  duplicate: 'Is a duplicate',
  unknown_field: 'Is not an allowed field',
  before_start: 'Must not be before the start',
});

export const URL_MAX_LENGTH = 2048;
export const EMAIL_MAX_LENGTH = 254;
/** Valid_Email format: a local part, `@`, and a domain with at least one dot and no empty labels. */
export const VALID_EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
export const PASSWORD_MAX_BYTES = 72;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PROFICIENCY_LEVELS = Object.freeze(['Beginner', 'Intermediate', 'Advanced', 'Expert']);
export const EMPLOYMENT_TYPES = Object.freeze([
  'Full-time',
  'Part-time',
  'Internship',
  'Contract',
  'Freelance',
  'Volunteer',
]);

/** Length in Unicode code points, so an astral character such as an emoji counts once. */
export const codePointLength = (s) => [...s].length;

/** True when `value` is a Valid_URL: ≤ 2048 characters, absolute, http(s), non-empty hostname. */
export function isValidUrl(value) {
  if (typeof value !== 'string' || codePointLength(value) > URL_MAX_LENGTH) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
}

/** True when `value` is a Valid_Email (at most 254 characters, `local@domain.tld`). */
export function isValidEmail(value) {
  return typeof value === 'string' && codePointLength(value) <= EMAIL_MAX_LENGTH && VALID_EMAIL_RE.test(value);
}

/** True when `value` is a real calendar date written as `YYYY-MM-DD`. */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// --- Result helpers -----------------------------------------------------------------------

/** Joins a parent path and a child key: `a` + `b` → `a.b`, `a` + `[2]` → `a[2]`, '' + `b` → `b`. */
export function joinPath(base, key) {
  if (key === '' || key === undefined || key === null) return base;
  const k = String(key);
  if (base === '') return k;
  return k.startsWith('[') ? `${base}${k}` : `${base}.${k}`;
}

export const pass = (value) => ({ ok: true, value });

/** Builds a failed Result with one error. */
export function fail(field, reason, message) {
  return { ok: false, errors: [{ field, reason, message: message ?? DEFAULT_MESSAGES[reason] ?? 'Is invalid' }] };
}

const isMissing = (value) => value === undefined || value === null;

/** True for `{}`-style objects (prototype Object.prototype or null); false for arrays, null and class instances. */
export const isPlainObject = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Applies the `required: false` option shared by several primitives. */
const withPresence = (rule, required) => (required === false ? optional(rule) : rule);

// --- Presence wrappers --------------------------------------------------------------------

/**
 * Accepts an omitted value (`undefined`), yielding `options.default` (undefined when not given).
 * Any other value, including null, goes to `rule`.
 */
export function optional(rule, options = {}) {
  const hasDefault = Object.hasOwn(options, 'default');
  return (value, path = '') => {
    if (value === undefined) return pass(hasDefault ? cloneDefault(options.default) : undefined);
    return rule(value, path);
  };
}

const cloneDefault = (v) => (Array.isArray(v) ? [...v] : v);

/**
 * Accepts null, yielding null. With `emptyAsNull: true`, a string that is empty after trimming
 * also yields null. Any other value (including undefined) goes to `rule`.
 */
export function nullable(rule, { emptyAsNull = false } = {}) {
  return (value, path = '') => {
    if (value === null) return pass(null);
    if (emptyAsNull && typeof value === 'string' && value.trim() === '') return pass(null);
    return rule(value, path);
  };
}

// --- Primitives ---------------------------------------------------------------------------

/**
 * A string, trimmed, whose length in code points is within `min`..`max`.
 * An empty trimmed value fails with `required` when `min` > 0.
 */
export function str({ min = 0, max, required = true, trim = true } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'string') return fail(path, 'type', 'Must be a string');
    const s = trim ? value.trim() : value;
    const length = codePointLength(s);
    if (length === 0 && min > 0) return fail(path, 'required');
    if (length < min) return fail(path, 'too_short', `Must be at least ${min} characters`);
    if (max !== undefined && length > max) return fail(path, 'too_long', `Must be at most ${max} characters`);
    return pass(s);
  };
  return withPresence(rule, required);
}

/** A JSON number that is an integer within `min`..`max`. Numeric strings, decimals, NaN and Infinity fail. */
export function int({ min, max, required = true } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'number' || !Number.isInteger(value)) return fail(path, 'type', 'Must be a whole number');
    if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
      return fail(path, 'out_of_range', rangeMessage(min, max));
    }
    return pass(value);
  };
  return withPresence(rule, required);
}

/**
 * A string of ASCII digits within `min`..`max`, converted to a number. For query strings and
 * path parameters, where numbers arrive as text. Not trimmed.
 */
export function digits({ min, max, required = true } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'string') return fail(path, 'type', 'Must be a string of digits');
    if (!/^[0-9]+$/.test(value)) return fail(path, 'invalid_format', 'Must contain only digits');
    const n = Number(value);
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
      return fail(path, 'out_of_range', rangeMessage(min, max));
    }
    return pass(n);
  };
  return withPresence(rule, required);
}

const rangeMessage = (min, max) => {
  if (min !== undefined && max !== undefined) return `Must be between ${min} and ${max}`;
  if (min !== undefined) return `Must be at least ${min}`;
  return `Must be at most ${max}`;
};

/** A JSON boolean. The strings "true" and "false" fail. */
export function bool({ required = true } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'boolean') return fail(path, 'type', 'Must be true or false');
    return pass(value);
  };
  return withPresence(rule, required);
}

/** An exact, case-sensitive member of `values`. The value is not trimmed. */
export function oneOf(values, { required = true } = {}) {
  const allowed = [...values];
  const listed = allowed.filter((v) => v !== '').join(', ');
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (!allowed.includes(value)) return fail(path, 'invalid_value', `Must be one of: ${listed}`);
    return pass(value);
  };
  return withPresence(rule, required);
}

/**
 * A Valid_URL after trimming. With `allowEmpty` (the default when `required: false`), a value
 * that is empty after trimming is accepted as ''.
 */
export function url({ required = true, allowEmpty = !required } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'string') return fail(path, 'type', 'Must be a string');
    const s = value.trim();
    if (s === '') return allowEmpty ? pass('') : fail(path, 'required');
    if (codePointLength(s) > URL_MAX_LENGTH) return fail(path, 'too_long', `Must be at most ${URL_MAX_LENGTH} characters`);
    if (!isValidUrl(s)) return fail(path, 'invalid_url');
    return pass(s);
  };
  return withPresence(rule, required);
}

/** A Valid_Email after trimming; with `lowercase: true` the result is lowercased (login). */
export function email({ required = true, lowercase = false } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'string') return fail(path, 'type', 'Must be a string');
    const s = value.trim();
    if (s === '') return fail(path, 'required');
    if (codePointLength(s) > EMAIL_MAX_LENGTH) {
      return fail(path, 'too_long', `Must be at most ${EMAIL_MAX_LENGTH} characters`);
    }
    if (!isValidEmail(s)) return fail(path, 'invalid_email');
    return pass(lowercase ? s.toLowerCase() : s);
  };
  return withPresence(rule, required);
}

/** A real calendar date in `YYYY-MM-DD` form, after trimming. */
export function isoDate({ required = true } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'string') return fail(path, 'type', 'Must be a string');
    const s = value.trim();
    if (s === '') return fail(path, 'required');
    if (!isIsoDate(s)) return fail(path, 'invalid_format', 'Must be a real date in YYYY-MM-DD format');
    return pass(s);
  };
  return withPresence(rule, required);
}

/** A password: a non-empty string of at most 72 UTF-8 bytes. Never trimmed. */
export function password({ maxBytes = PASSWORD_MAX_BYTES } = {}) {
  return (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'string') return fail(path, 'type', 'Must be a string');
    if (value === '') return fail(path, 'required');
    if (Buffer.byteLength(value, 'utf8') > maxBytes) return fail(path, 'too_long', `Must be at most ${maxBytes} bytes`);
    return pass(value);
  };
}

// --- Combinators --------------------------------------------------------------------------

/**
 * An array with `min`..`max` items, each checked by `item` at path `path[i]`. Errors from every
 * item are collected. A list outside the length bounds reports one error on the list itself.
 *
 * `unique(itemValue) => key` (optional) reports `duplicate` on every later item whose key equals
 * an earlier one, for example `(name) => name.toLowerCase()`. It runs only when every item passes.
 */
export function list(item, { min = 0, max, unique, required = true } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (!Array.isArray(value)) return fail(path, 'type', 'Must be a list');
    if (value.length < min) return fail(path, 'too_short', `Must have at least ${min} items`);
    if (max !== undefined && value.length > max) return fail(path, 'too_long', `Must have at most ${max} items`);

    const errors = [];
    const out = [];
    value.forEach((entry, i) => {
      const result = item(entry, `${path}[${i}]`);
      if (result.ok) out.push(result.value);
      else errors.push(...result.errors);
    });
    if (errors.length > 0) return { ok: false, errors };

    if (unique) {
      const seen = new Set();
      out.forEach((entry, i) => {
        const key = unique(entry);
        if (seen.has(key)) errors.push(fail(`${path}[${i}]`, 'duplicate').errors[0]);
        else seen.add(key);
      });
      if (errors.length > 0) return { ok: false, errors };
    }
    return pass(out);
  };
  return withPresence(rule, required);
}

/**
 * A plain JSON object checked field by field against `shape` (key → rule).
 * Errors from every field are collected. Keys not in `shape`:
 * - `unknown: 'reject'` (default): one `unknown_field` error per key, at its full path;
 * - `unknown: 'strip'`: dropped silently.
 * Nested objects apply their own `unknown` option, so rejection works at every nesting level.
 * The output holds only shape keys whose normalized value is not `undefined`.
 */
export function object(shape, { unknown = 'reject', required = true } = {}) {
  const keys = Object.keys(shape);
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (!isPlainObject(value)) return fail(path, 'type', 'Must be an object');

    const errors = [];
    const out = {};
    for (const key of keys) {
      const fieldValue = Object.hasOwn(value, key) ? value[key] : undefined;
      const result = shape[key](fieldValue, joinPath(path, key));
      if (!result.ok) errors.push(...result.errors);
      else if (result.value !== undefined) out[key] = result.value;
    }
    if (unknown === 'reject') {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(shape, key)) errors.push(fail(joinPath(path, key), 'unknown_field').errors[0]);
      }
    }
    return errors.length > 0 ? { ok: false, errors } : pass(out);
  };
  return withPresence(rule, required);
}

/**
 * Cross-field rules. `check(normalizedValue, path)` runs only when `schema` passes and returns
 * a falsy value or an array of `{ field, reason, message? }`, where `field` is relative to
 * `path` ('' means the value itself).
 */
export function refine(schema, check) {
  return (value, path = '') => {
    const result = schema(value, path);
    if (!result.ok) return result;
    const issues = check(result.value, path);
    if (!issues || issues.length === 0) return result;
    return {
      ok: false,
      errors: issues.map((i) => fail(joinPath(path, i.field ?? ''), i.reason, i.message).errors[0]),
    };
  };
}

/** Transforms the normalized value of a passing rule, e.g. `map(oneOf(['true', 'false']), (v) => v === 'true')`. */
export function map(rule, fn) {
  return (value, path = '') => {
    const result = rule(value, path);
    return result.ok ? pass(fn(result.value)) : result;
  };
}
