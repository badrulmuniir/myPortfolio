// Client-side form validation (Requirements 9.7, 29.2, 29.3, 30.2, 31.7, 31.8, 31.15).
//
// These rules mirror the server Validator in server/src/validators/*.js, server/src/utils/slug.js
// and server/src/utils/sanitize.js. The client does not import server code, so every rule and
// constant is repeated here and must stay identical to the server version.
//
// Every form validator returns
//   { valid, errors, details, values }
// - `errors`: `{ [field]: message }` with the first failing rule per field. The keys are the
//   server `details[].field` paths (`title`, `features[2]`, `social_links[0].url`, ...), so a
//   form can show client errors and server errors (see `errorsFromDetails`) on the same fields.
// - `details`: the same errors as `[{ field, reason, message }]`, in the server format.
// - `values`: the trimmed, normalized payload to submit when `valid` is true, otherwise `null`.
//   Only the fields of the form's schema are picked; other keys in the input are ignored.
//
// Differences from the server, all on purpose:
// - Whole-number fields (`display_order`, `start_year`, `end_year`) accept the string value of an
//   `<input type="number">` as well as a number. The string is trimmed and must be an optional
//   minus sign followed by ASCII digits ("12", " 7 ", "-1"); "1.5", "1e3", "+3" and "12abc" fail
//   with `type`. The submitted value is always a JSON number, which the server requires.
// - Unknown keys in the form values are ignored instead of reported, because forms never send
//   them (only the picked `values` are submitted).
// - The login email is trimmed but not lowercased; the server lowercases it.

import { URL_MAX_LENGTH, isValidUrl } from './url.js';

export { URL_MAX_LENGTH, isValidUrl };

// --- Shared definitions (identical to the server) -----------------------------------------

export const EMAIL_MAX_LENGTH = 254;
/** Valid_Email format: a local part, `@`, and a domain with at least one dot and no empty labels. */
export const VALID_EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
export const PASSWORD_MAX_BYTES = 72;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 160;

export const PROFICIENCY_LEVELS = Object.freeze(['Beginner', 'Intermediate', 'Advanced', 'Expert']);
export const EMPLOYMENT_TYPES = Object.freeze([
  'Full-time',
  'Part-time',
  'Internship',
  'Contract',
  'Freelance',
  'Volunteer',
]);

export const DISPLAY_ORDER_MIN = 0;
export const DISPLAY_ORDER_MAX = 9999;
export const PROJECT_FEATURES_MAX = 30;
export const PROJECT_TECHNOLOGIES_MAX = 30;
export const TECHNOLOGY_NAME_MAX = 50;
export const RESPONSIBILITIES_MAX = 20;
export const SOCIAL_LINKS_MAX = 10;
export const EDUCATION_MIN_YEAR = 1950;
/** How many years after the current UTC year a start or end year may be. */
export const EDUCATION_YEARS_AHEAD = 10;

/** Contact fields in the order used to focus the first invalid field (29.3). */
export const CONTACT_FIELD_ORDER = Object.freeze(['name', 'email', 'subject', 'message']);
/** Login fields in display order. */
export const LOGIN_FIELD_ORDER = Object.freeze(['email', 'password']);
/** Name of the Honeypot_Field; its value is sent unchanged and never validated (29.9). */
export const HONEYPOT_FIELD = 'website';

/** Length in Unicode code points, so an astral character such as an emoji counts once. */
export const codePointLength = (s) => [...s].length;

/** Length in UTF-8 bytes (same count as the server's `Buffer.byteLength(s, 'utf8')`). */
export const utf8ByteLength = (s) => new TextEncoder().encode(s).length;

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

/** True when `value` satisfies the Slug definition: ≤ 160 characters, SLUG_RE, at least one letter. */
export function isSlug(value) {
  return typeof value === 'string' && value.length <= SLUG_MAX && SLUG_RE.test(value) && /[a-z]/.test(value);
}

// eslint-disable-next-line no-control-regex -- matching control characters is the purpose (18.4)
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Contact sanitizing, as on the server (18.4): removes U+0000–U+0008, U+000B, U+000C,
 * U+000E–U+001F and U+007F, then trims. Non-string values are returned unchanged.
 */
export function sanitizeText(value) {
  if (typeof value !== 'string') return value;
  return value.replace(DISALLOWED_CONTROL, '').trim();
}

// --- Messages -----------------------------------------------------------------------------

/** Fallback message per reason token, used when a server detail has no message. */
export const REASON_MESSAGES = Object.freeze({
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

const rangeMessage = (min, max) => {
  if (min !== undefined && max !== undefined) return `Must be between ${min} and ${max}`;
  if (min !== undefined) return `Must be at least ${min}`;
  return `Must be at most ${max}`;
};

// --- Rule primitives (same Result shape as the server rules) ------------------------------

const pass = (value) => ({ ok: true, value });
const fail = (field, reason, message) => ({
  ok: false,
  errors: [{ field, reason, message: message ?? REASON_MESSAGES[reason] ?? 'Is invalid' }],
});
const isMissing = (value) => value === undefined || value === null;

const joinPath = (base, key) => {
  if (key === '' || key === undefined || key === null) return base;
  const k = String(key);
  if (base === '') return k;
  return k.startsWith('[') ? `${base}${k}` : `${base}.${k}`;
};

const isPlainObject = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Omitted (`undefined`) → `options.default`; anything else (including null) goes to `rule`. */
function optional(rule, options = {}) {
  const hasDefault = Object.hasOwn(options, 'default');
  return (value, path = '') => {
    if (value === undefined) return pass(hasDefault ? cloneDefault(options.default) : undefined);
    return rule(value, path);
  };
}
const cloneDefault = (v) => (Array.isArray(v) ? [...v] : v);

/** null → null; with `emptyAsNull`, a blank string → null too. */
function nullable(rule, { emptyAsNull = false } = {}) {
  return (value, path = '') => {
    if (value === null) return pass(null);
    if (emptyAsNull && typeof value === 'string' && value.trim() === '') return pass(null);
    return rule(value, path);
  };
}

const withPresence = (rule, required) => (required === false ? optional(rule) : rule);

function str({ min = 0, max, required = true } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'string') return fail(path, 'type', 'Must be text');
    const s = value.trim();
    const length = codePointLength(s);
    if (length === 0 && min > 0) return fail(path, 'required');
    if (length < min) return fail(path, 'too_short', `Must be at least ${min} characters`);
    if (max !== undefined && length > max) return fail(path, 'too_long', `Must be at most ${max} characters`);
    return pass(s);
  };
  return withPresence(rule, required);
}

const FORM_INT_RE = /^-?[0-9]+$/;

/**
 * A whole number within `min`..`max`. Accepts a JSON number or the string value of a number
 * input (trimmed, optional minus sign, ASCII digits). Yields a number.
 */
function formInt({ min, max, required = true } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    let n;
    if (typeof value === 'number') {
      n = value;
    } else if (typeof value === 'string') {
      const s = value.trim();
      if (s === '') return fail(path, 'required');
      if (!FORM_INT_RE.test(s)) return fail(path, 'type', 'Must be a whole number');
      n = Number(s);
    } else {
      return fail(path, 'type', 'Must be a whole number');
    }
    if (!Number.isInteger(n)) return fail(path, 'type', 'Must be a whole number');
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
      return fail(path, 'out_of_range', rangeMessage(min, max));
    }
    return pass(n === 0 ? 0 : n); // turns -0 into 0
  };
  return withPresence(rule, required);
}

function bool({ required = true } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'boolean') return fail(path, 'type', 'Must be true or false');
    return pass(value);
  };
  return withPresence(rule, required);
}

function oneOf(values, { required = true } = {}) {
  const allowed = [...values];
  const listed = allowed.filter((v) => v !== '').join(', ');
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (!allowed.includes(value)) return fail(path, 'invalid_value', `Must be one of: ${listed}`);
    return pass(value);
  };
  return withPresence(rule, required);
}

function url({ required = true, allowEmpty = !required } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'string') return fail(path, 'type', 'Must be text');
    const s = value.trim();
    if (s === '') return allowEmpty ? pass('') : fail(path, 'required');
    if (codePointLength(s) > URL_MAX_LENGTH) return fail(path, 'too_long', `Must be at most ${URL_MAX_LENGTH} characters`);
    if (!isValidUrl(s)) return fail(path, 'invalid_url');
    return pass(s);
  };
  return withPresence(rule, required);
}

function email({ required = true } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'string') return fail(path, 'type', 'Must be text');
    const s = value.trim();
    if (s === '') return fail(path, 'required');
    if (codePointLength(s) > EMAIL_MAX_LENGTH) {
      return fail(path, 'too_long', `Must be at most ${EMAIL_MAX_LENGTH} characters`);
    }
    if (!isValidEmail(s)) return fail(path, 'invalid_email');
    return pass(s);
  };
  return withPresence(rule, required);
}

function isoDate({ required = true } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'string') return fail(path, 'type', 'Must be text');
    const s = value.trim();
    if (s === '') return fail(path, 'required');
    if (!isIsoDate(s)) return fail(path, 'invalid_format', 'Must be a real date in YYYY-MM-DD format');
    return pass(s);
  };
  return withPresence(rule, required);
}

function password() {
  return (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (typeof value !== 'string') return fail(path, 'type', 'Must be text');
    if (value === '') return fail(path, 'required');
    if (utf8ByteLength(value) > PASSWORD_MAX_BYTES) {
      return fail(path, 'too_long', `Must be at most ${PASSWORD_MAX_BYTES} bytes`);
    }
    return pass(value);
  };
}

function list(item, { max, unique, uniqueMessage, required = true } = {}) {
  const rule = (value, path = '') => {
    if (isMissing(value)) return fail(path, 'required');
    if (!Array.isArray(value)) return fail(path, 'type', 'Must be a list');
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
        if (seen.has(key)) errors.push(fail(`${path}[${i}]`, 'duplicate', uniqueMessage).errors[0]);
        else seen.add(key);
      });
      if (errors.length > 0) return { ok: false, errors };
    }
    return pass(out);
  };
  return withPresence(rule, required);
}

/** Checks the keys of `shape` only; other keys are ignored. Omitted optional values stay out. */
function object(shape) {
  const keys = Object.keys(shape);
  return (value, path = '') => {
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
    return errors.length > 0 ? { ok: false, errors } : pass(out);
  };
}

/** Cross-field rules that run only when `schema` passes. `check` returns null or issues. */
function refine(schema, check) {
  return (value, path = '') => {
    const result = schema(value, path);
    if (!result.ok) return result;
    const issues = check(result.value);
    if (!issues || issues.length === 0) return result;
    return {
      ok: false,
      errors: issues.map((i) => fail(joinPath(path, i.field ?? ''), i.reason, i.message).errors[0]),
    };
  };
}

// --- Error shapes -------------------------------------------------------------------------

/** Key used for an error on the whole form (server field '' is reported as `body`). */
export const FORM_ERROR_KEY = 'body';

/**
 * Converts server Error_Response `details` (`[{ field, reason, message }]`) to the
 * `{ [field]: message }` shape of the form validators, keeping the first message per field.
 * List item paths keep their index (`features[2]`, `social_links[0].url`), so a form shows them
 * next to the matching item. A missing or empty message falls back to the reason's default text.
 * An empty field becomes `body`. Entries that are not objects with a string field are skipped,
 * and a non-array argument returns `{}`.
 *
 * @param {unknown} details
 * @returns {Record<string, string>}
 */
export function errorsFromDetails(details) {
  const errors = {};
  if (!Array.isArray(details)) return errors;
  for (const d of details) {
    if (!d || typeof d !== 'object' || typeof d.field !== 'string') continue;
    const field = d.field === '' ? FORM_ERROR_KEY : d.field;
    if (Object.hasOwn(errors, field)) continue;
    const message =
      typeof d.message === 'string' && d.message.trim() !== ''
        ? d.message
        : (REASON_MESSAGES[d.reason] ?? 'Is invalid');
    errors[field] = message;
  }
  return errors;
}

/**
 * The first field in `order` that has an error, or null. With no order, the first error key.
 * Used to move focus to the first invalid field (29.3).
 */
export function firstInvalidField(errors, order) {
  if (!errors) return null;
  if (order) return order.find((field) => Object.hasOwn(errors, field)) ?? null;
  return Object.keys(errors)[0] ?? null;
}

/** Runs a schema and returns `{ valid, errors, details, values }`. */
function run(schema, values) {
  const result = schema(values, '');
  if (result.ok) return { valid: true, errors: {}, details: [], values: result.value };
  const details = result.errors.map((e) => (e.field === '' ? { ...e, field: FORM_ERROR_KEY } : e));
  return { valid: false, errors: errorsFromDetails(details), details, values: null };
}

// --- Schemas ------------------------------------------------------------------------------

const loginSchema = object({
  email: email(),
  password: password(),
});

const contactShape = object({
  name: str({ min: 1, max: 100 }),
  email: email(),
  subject: str({ min: 1, max: 150 }),
  message: str({ min: 10, max: 5000 }),
  [HONEYPOT_FIELD]: (value) => pass(value),
});

/** Contact body: the four fields are sanitized before the rules run, as on the server. */
function contactSchema(value, path = '') {
  if (!isPlainObject(value)) return contactShape(value, path);
  const sanitized = { ...value };
  for (const field of CONTACT_FIELD_ORDER) {
    if (Object.hasOwn(value, field)) sanitized[field] = sanitizeText(value[field]);
  }
  return contactShape(sanitized, path);
}

function slugField(value, path = '') {
  if (value === undefined) return pass(undefined);
  const result = str({ max: SLUG_MAX })(value, path);
  if (!result.ok) return result;
  if (result.value === '') return pass(undefined);
  if (!isSlug(result.value)) {
    return fail(
      path,
      'invalid_format',
      'Must use lowercase letters a-z, digits and single hyphens, and contain at least one letter',
    );
  }
  return result;
}

const longText = () => optional(str({ max: 10000 }), { default: '' });
const optionalUrl = () => optional(url({ allowEmpty: true }), { default: '' });
const displayOrder = () => formInt({ min: DISPLAY_ORDER_MIN, max: DISPLAY_ORDER_MAX });

const projectSchema = object({
  title: str({ min: 1, max: 150 }),
  slug: slugField,
  short_description: str({ min: 1, max: 300 }),
  full_description: longText(),
  problem_statement: longText(),
  objectives: longText(),
  challenges: longText(),
  solutions: longText(),
  category: str({ min: 1, max: 50 }),
  image_url: optionalUrl(),
  github_url: optionalUrl(),
  live_demo_url: optionalUrl(),
  display_order: displayOrder(),
  is_published: bool({ required: false }),
  features: optional(list(str({ min: 1, max: 300 }), { max: PROJECT_FEATURES_MAX }), { default: [] }),
  technologies: optional(
    list(str({ min: 1, max: TECHNOLOGY_NAME_MAX }), {
      max: PROJECT_TECHNOLOGIES_MAX,
      unique: (name) => name.toLowerCase(),
      uniqueMessage: 'This technology is already listed',
    }),
    { default: [] },
  ),
});

const skillSchema = object({
  name: str({ min: 1, max: 50 }),
  category: str({ min: 1, max: 50 }),
  proficiency_level: optional(oneOf(['', ...PROFICIENCY_LEVELS]), { default: '' }),
  icon_url: optional(url({ allowEmpty: true }), { default: '' }),
  display_order: displayOrder(),
});

const experienceSchema = refine(
  object({
    job_title: str({ min: 1, max: 100 }),
    company_name: str({ min: 1, max: 100 }),
    employment_type: oneOf(EMPLOYMENT_TYPES),
    start_date: isoDate(),
    end_date: optional(nullable(isoDate(), { emptyAsNull: true })),
    description: str({ max: 5000, required: false }),
    responsibilities: optional(list(str({ min: 1, max: 300 }), { max: RESPONSIBILITIES_MAX })),
  }),
  (value) =>
    typeof value.end_date === 'string' && value.end_date < value.start_date
      ? [{ field: 'end_date', reason: 'before_start', message: 'End date must not be before the start date' }]
      : null,
);

const educationSchema = (maxYear) =>
  refine(
    object({
      institution: str({ min: 1, max: 150 }),
      qualification: str({ min: 1, max: 150 }),
      field_of_study: optional(str({ max: 150 }), { default: '' }),
      start_year: formInt({ min: EDUCATION_MIN_YEAR, max: maxYear }),
      end_year: optional(nullable(formInt({ min: EDUCATION_MIN_YEAR, max: maxYear }), { emptyAsNull: true }), {
        default: null,
      }),
      description: optional(str({ max: 5000 }), { default: '' }),
    }),
    (value) =>
      value.end_year !== null && value.end_year < value.start_year
        ? [{ field: 'end_year', reason: 'before_start', message: 'End year must not be before the start year' }]
        : null,
  );

const profileSchema = object({
  name: str({ min: 1, max: 100 }),
  professional_title: str({ min: 1, max: 100 }),
  email: email(),
  personal_introduction: str({ max: 5000, required: false }),
  biography: str({ max: 5000, required: false }),
  career_interests: str({ max: 5000, required: false }),
  professional_goals: str({ max: 5000, required: false }),
  profile_image_url: url({ required: false }),
  github_url: url({ required: false }),
  linkedin_url: url({ required: false }),
});

const SETTINGS_KEYS = ['site_title', 'hero_introduction', 'footer_text', 'social_links'];

const settingsSchema = refine(
  object({
    site_title: str({ min: 1, max: 100, required: false }),
    hero_introduction: str({ max: 500, required: false }),
    footer_text: str({ max: 300, required: false }),
    social_links: list(object({ label: str({ min: 1, max: 50 }), url: url() }), {
      max: SOCIAL_LINKS_MAX,
      required: false,
    }),
  }),
  (value) =>
    Object.keys(value).length === 0
      ? [{ field: '', reason: 'required', message: `Provide at least one of: ${SETTINGS_KEYS.join(', ')}` }]
      : null,
);

// --- Form validators ----------------------------------------------------------------------

/**
 * Contact form (29.2, 29.3). Sanitizes and trims name, email, subject and message, then checks
 * name 1–100, email Valid_Email, subject 1–150 and message 10–5000 code points. `website` (the
 * Honeypot_Field) is passed through unchanged when present. Use `CONTACT_FIELD_ORDER` with
 * `firstInvalidField` to focus the first invalid field.
 */
export const validateContact = (values) => run(contactSchema, values);

/** Login form (30.2): email trimmed Valid_Email; password non-empty, ≤ 72 UTF-8 bytes, not trimmed. */
export const validateLogin = (values) => run(loginSchema, values);

/**
 * Project form (31.7). `slug` that is omitted or blank is left out of `values` (the server
 * generates or keeps it). `display_order` may be a number or a number-input string.
 */
export const validateProject = (values) => run(projectSchema, values);

/** Skill form (31.7). Omitted `proficiency_level` and `icon_url` become ''. */
export const validateSkill = (values) => run(skillSchema, values);

/**
 * Experience form (31.7). `end_date` '' or null → null; a date before `start_date` fails with
 * `before_start` on `end_date`. `responsibilities`: 0–20 items of 1–300 characters.
 */
export const validateExperience = (values) => run(experienceSchema, values);

/**
 * Education form (31.7). Years are whole numbers from 1950 to Y+10, where Y is the UTC year of
 * `now` (a function returning a timestamp or Date, a Date, or a timestamp; default `Date.now`).
 * `end_year` '' or null → null and must not be less than `start_year`.
 */
export function validateEducation(values, { now = Date.now } = {}) {
  const instant = typeof now === 'function' ? now() : now;
  const maxYear = new Date(instant).getUTCFullYear() + EDUCATION_YEARS_AHEAD;
  return run(educationSchema(maxYear), values);
}

/** Profile form: name, professional_title and email required; omitted optional fields stay out. */
export const validateProfile = (values) => run(profileSchema, values);

/** Settings form: at least one key; `social_links` 0–10 `{ label 1–50, url Valid_URL }`. */
export const validateSettings = (values) => run(settingsSchema, values);

// --- Technology tags (31.8) ---------------------------------------------------------------

/**
 * The reason `name` cannot be added to `list`, or null when it can. Checks, in order: empty or
 * whitespace-only, longer than 50 characters after trimming, a case-insensitive duplicate of a
 * name already in the list, and a list that already has 30 names.
 *
 * @param {string[]} list
 * @param {unknown} name
 * @returns {string | null}
 */
export function tagError(list, name, { max = PROJECT_TECHNOLOGIES_MAX, maxLength = TECHNOLOGY_NAME_MAX } = {}) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed === '') return 'Enter a technology name';
  if (codePointLength(trimmed) > maxLength) return `Must be at most ${maxLength} characters`;
  const key = trimmed.toLowerCase();
  if (list.some((existing) => String(existing).trim().toLowerCase() === key)) {
    return 'This technology is already listed';
  }
  if (list.length >= max) return `A project can have at most ${max} technologies`;
  return null;
}

/**
 * Returns a new list with the trimmed `name` appended, or `list` itself (same reference) when the
 * name is rejected by `tagError`.
 *
 * @param {string[]} list
 * @param {unknown} name
 * @returns {string[]}
 */
export function addTag(list, name, options) {
  if (tagError(list, name, options) !== null) return list;
  return [...list, name.trim()];
}
