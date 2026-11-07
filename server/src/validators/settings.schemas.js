// Settings request schema (Requirements 11.2, 11.3, 11.4, 11.7, 11.8).
import { list, object, refine, str, url } from './rules.js';

/** The allowed Settings keys (assumption A11). */
export const SETTINGS_KEYS = Object.freeze(['site_title', 'hero_introduction', 'footer_text', 'social_links']);

export const SOCIAL_LINKS_MAX = 10;

/** One Social_Link: only `label` (1–50 after trimming) and `url` (Valid_URL). Unknown keys rejected. */
const socialLink = object({
  label: str({ min: 1, max: 50 }),
  url: url(),
});

const settingsShape = object({
  site_title: str({ min: 1, max: 100, required: false }),
  hero_introduction: str({ max: 500, required: false }),
  footer_text: str({ max: 300, required: false }),
  social_links: list(socialLink, { max: SOCIAL_LINKS_MAX, required: false }),
});

/**
 * `PUT /api/settings` body. Every key is optional, but at least one allowed key must be present
 * (11.8). Keys outside SETTINGS_KEYS are rejected with `unknown_field` (11.3). The "at least one
 * key" error is reported on the body itself (field '', which `validate` reports as `body`).
 */
export const settingsBody = refine(settingsShape, (value) =>
  Object.keys(value).length === 0
    ? [{ field: '', reason: 'required', message: `Provide at least one of: ${SETTINGS_KEYS.join(', ')}` }]
    : null,
);
