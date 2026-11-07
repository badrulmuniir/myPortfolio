// Skill request schema (Requirements 15.3, 15.7, 15.8).
import { PROFICIENCY_LEVELS, int, object, oneOf, optional, str, url } from './rules.js';

/**
 * `POST /api/skills` and `PUT /api/skills/:id` body.
 * - Required: `name` 1–50, `category` 1–50 (both trimmed), `display_order` int 0–9999 (decimals and
 *   numeric strings rejected).
 * - `proficiency_level`: '' or an exact, case-sensitive Proficiency_Level; omitted → ''.
 * - `icon_url`: '' or a Valid_URL; omitted → ''.
 * Omitted optional fields become '' because a Skill PUT sets them to empty (15.7).
 */
export const skillBody = object({
  name: str({ min: 1, max: 50 }),
  category: str({ min: 1, max: 50 }),
  proficiency_level: optional(oneOf(['', ...PROFICIENCY_LEVELS]), { default: '' }),
  icon_url: optional(url({ allowEmpty: true }), { default: '' }),
  display_order: int({ min: 0, max: 9999 }),
});
