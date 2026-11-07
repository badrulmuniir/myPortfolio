// Project_Identifier parsing (Requirements 4.10, 12.3, 12.4, 12.5; design "Project_Identifier Parsing").
import { isSlug } from '../utils/slug.js';
import { ID_MAX } from './params.schemas.js';

/**
 * Classifies the `:identifier` of `GET /api/projects/:identifier`.
 * - Only ASCII digits: `{ kind: 'id', id }` when 1..2,147,483,647, else `{ kind: 'invalid' }`
 *   (400 INVALID_ID, 4.10). Leading zeros are allowed: '007' is id 7.
 * - Otherwise a valid Slug: `{ kind: 'slug', slug }`, matched case-sensitively (12.4).
 * - Anything else, including 'My-Project' and non-strings: `{ kind: 'none' }`, answered with the
 *   same 404 as a missing Project without querying the Database (12.5).
 *
 * @param {unknown} raw
 * @returns {{ kind: 'id', id: number } | { kind: 'invalid' } | { kind: 'slug', slug: string } | { kind: 'none' }}
 */
export function classifyIdentifier(raw) {
  if (typeof raw !== 'string') return { kind: 'none' };
  if (/^[0-9]+$/.test(raw)) {
    const n = Number(raw);
    return n >= 1 && n <= ID_MAX ? { kind: 'id', id: n } : { kind: 'invalid' };
  }
  return isSlug(raw) ? { kind: 'slug', slug: raw } : { kind: 'none' };
}
