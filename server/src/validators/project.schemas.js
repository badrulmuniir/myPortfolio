// Project request schemas (Requirements 12.2, 12.10, 13.7, 13.8, 13.9, 13.13, 13.16, 13.19, 14.6).
import { bool, fail, int, list, object, optional, pass, str, url } from './rules.js';
import { SLUG_MAX, isSlug } from '../utils/slug.js';

/**
 * `GET /api/projects` query. `category` is optional; when present it must be 1–50 characters
 * after trimming, so an empty or whitespace-only value fails with `required` and a longer one with
 * `too_long` (12.10).
 *
 * Unknown query parameters are ignored, not rejected: Requirement 9.6 covers request bodies, and
 * public URLs often carry cache-busters or tracking parameters (`?utm_source=…`, `?_=…`).
 */
export const publicProjectQuery = object(
  {
    category: str({ min: 1, max: 50, required: false }),
  },
  { unknown: 'strip' },
);

/**
 * Optional Slug field. Omitted, empty or whitespace-only → `undefined` (left out of the normalized
 * body), meaning "not supplied": the service generates a Slug on create and keeps the stored one
 * on update (13.10, 13.16). Any other value is trimmed and must satisfy the Slug definition (13.13).
 */
export function slugField(value, path = '') {
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

/** Optional long text: omitted → '' (Project PUT replaces text fields, design "PUT Semantics"). */
const longText = () => optional(str({ max: 10000 }), { default: '' });
/** Optional URL: omitted → '', '' clears the value, anything else must be a Valid_URL. */
const optionalUrl = () => optional(url({ allowEmpty: true }), { default: '' });

export const PROJECT_FEATURES_MAX = 30;
export const PROJECT_TECHNOLOGIES_MAX = 30;

/**
 * `POST /api/projects` and `PUT /api/projects/:id` body.
 * - Required: `title` 1–150, `short_description` 1–300, `category` 1–50, `display_order` int 0–9999.
 * - Optional text and URL fields default to ''; `features` and `technologies` default to [].
 * - `is_published` (optional bool) and `slug` (optional) stay `undefined` when omitted, so the
 *   service applies the create default (unpublished, generated Slug) or keeps the stored value.
 * - `technologies`: no two names equal after trimming and case-insensitive comparison; every later
 *   duplicate is reported with `duplicate` at `technologies[i]` (14.6).
 * Unknown keys are rejected (9.6).
 */
export const projectBody = object({
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
  display_order: int({ min: 0, max: 9999 }),
  is_published: bool({ required: false }),
  features: optional(list(str({ min: 1, max: 300 }), { max: PROJECT_FEATURES_MAX }), { default: [] }),
  technologies: optional(
    list(str({ min: 1, max: 50 }), { max: PROJECT_TECHNOLOGIES_MAX, unique: (name) => name.toLowerCase() }),
    { default: [] },
  ),
});

/** `PATCH /api/projects/:id/publish` body: a JSON boolean `is_published`, required (13.19). */
export const publishBody = object({
  is_published: bool(),
});
