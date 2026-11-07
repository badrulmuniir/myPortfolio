// Helpers shared by the skill management pages (Requirements 15.4, 15.5, 31.16).

import { NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';

export const SKILLS_PATH = '/admin/skills';
export const NEW_SKILL_PATH = `${SKILLS_PATH}/new`;
export const editSkillPath = (id) => `${SKILLS_PATH}/${encodeURIComponent(String(id))}/edit`;

/** The category suggestions the Skill form always offers (15.4). */
export const DEFAULT_SKILL_CATEGORIES = Object.freeze([
  'Frontend Development',
  'Backend Development',
  'Database',
  'Programming Languages',
  'Development Tools',
]);

/**
 * The five default categories followed by every other category already used by a Skill, in
 * the order of `skills`, without duplicates. Duplicates are exact matches only: an existing
 * `database` is offered next to the default `Database`, because a Skill is grouped by its
 * exact category value and the Administrator may want to add to that group.
 *
 * @param {Array<{ category?: unknown }> | null | undefined} skills
 * @returns {string[]}
 */
export function categorySuggestions(skills) {
  const seen = new Set(DEFAULT_SKILL_CATEGORIES);
  const result = [...DEFAULT_SKILL_CATEGORIES];
  for (const skill of Array.isArray(skills) ? skills : []) {
    const category = typeof skill?.category === 'string' ? skill.category : '';
    if (category.trim() === '' || seen.has(category)) continue;
    seen.add(category);
    result.push(category);
  }
  return result;
}

/**
 * The full `PUT /api/skills/:id` body for a stored Skill. A Skill PUT replaces every field
 * (15.7), so a move resends the saved values with only `display_order` changed.
 */
export function toSkillInput(skill, displayOrder = skill.display_order) {
  return {
    name: skill.name,
    category: skill.category,
    proficiency_level: skill.proficiency_level ?? '',
    icon_url: skill.icon_url ?? '',
    display_order: displayOrder,
  };
}

/** True for a 401 failure. The API_Client's unauthorized handler deals with those (6.4). */
export const isUnauthorized = (error) => error?.status === 401;

/** The Error_Response message, or the "server could not be reached" message (31.16). */
export function failureMessage(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  return message !== '' ? message : NETWORK_ERROR_MESSAGE;
}
