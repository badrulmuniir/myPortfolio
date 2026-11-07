// Skill move up/down for the admin skills list (15.5).
// Pure functions: they never mutate their input and never send requests.
//
// Grouping: a skill's category group is every skill whose category is the exact same value
// (strict equality), in the order of the input list. This matches `groupSkills` in
// utils/filters.js, which builds the groups the admin list displays, so the "first" and
// "last" skill of a group here are the ones whose controls the page disables. Skills
// whose categories differ only in letter case (for example `Database` and `database`)
// are separate groups; the server still sorts them together by lower(category), but a
// move never changes the relative order of skills outside the moved skill's own group.
//
// Ids are compared with strict equality, so pass the id with the same type the API
// returned (a number).

/** Highest `display_order` the API accepts (15.3). */
export const MAX_DISPLAY_ORDER = 9999;

const DIRECTIONS = new Set(['up', 'down']);

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const lower = (value) => String(value ?? '').toLowerCase();

/**
 * The `GET /api/skills` comparator (15.1): lower(category), then display_order, then
 * lower(name), then id, all ascending. Text is compared by code point, as the server's
 * `COLLATE "C"` does.
 */
export function compareSkills(a, b) {
  return (
    compareText(lower(a.category), lower(b.category)) ||
    a.display_order - b.display_order ||
    compareText(lower(a.name), lower(b.name)) ||
    a.id - b.id
  );
}

/**
 * Finds the target skill, its category group (input order) and the index of the
 * neighbor it would trade places with. Returns null when there is nothing to move.
 */
function locateMove(skills, skillId, direction) {
  if (!Array.isArray(skills) || !DIRECTIONS.has(direction)) return null;

  const target = skills.find((skill) => skill?.id === skillId);
  if (!target) return null;

  const group = skills.filter((skill) => skill?.category === target.category);
  const index = group.indexOf(target);
  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= group.length) return null;

  return { group, index, neighborIndex };
}

/**
 * True when `skillId` has a neighbor in its category group in `direction` ('up' or
 * 'down'). False for the first skill moving up, the last skill moving down, an unknown
 * id, an unknown direction or a non-array list. Use it to disable the move controls.
 */
export function canMove(skills, skillId, direction) {
  return locateMove(skills, skillId, direction) !== null;
}

/**
 * Computes the `PUT /api/skills/:id` updates that move one skill up or down within its
 * category group (15.5).
 *
 * `skills` is the list as returned by `GET /api/skills`; `direction` is 'up' or 'down'.
 *
 * Returns `{ updates, order }`:
 * - `updates`: `[{ id, display_order }]`, the new value for each skill to save. Every
 *   other field of those skills stays as it is in the input list.
 * - `order`: the ids of the category group in the order that results from the move.
 *
 * Rules:
 * - Target and neighbor have different `display_order` values: the two values are
 *   swapped, giving exactly two updates. Exception: when a plain swap, re-sorted like
 *   the server, would not give the moved order, the group is renumbered instead (next
 *   rule). This happens when another skill in the group shares one of the two values
 *   and the name/id tie-break puts it on the wrong side of a swapped skill, or when the
 *   input is not in server order. Requirement 15.5 asks for the moved order; the swap is
 *   used whenever it produces that order.
 * - Equal values (or the exception above): the group's skills get 0, 1, 2, … in the
 *   order that results from the move, and only skills whose value changes are listed.
 * - No neighbor (first skill moving up, last moving down), unknown id, unknown
 *   direction or a non-array list: `{ updates: [], order: [] }` for an unknown id and
 *   `{ updates: [], order: <current group order> }` at an edge.
 *
 * Bound: renumbering assigns values up to group size − 1, so a group of at most
 * 10000 skills stays within 0–9999. A larger group throws a RangeError instead of
 * producing values the API would reject.
 *
 * The input list and its skill objects are never mutated.
 */
export function computeSkillMove(skills, skillId, direction) {
  const located = locateMove(skills, skillId, direction);
  if (!located) {
    const target = Array.isArray(skills) ? skills.find((skill) => skill?.id === skillId) : undefined;
    const order = target
      ? skills.filter((skill) => skill?.category === target.category).map((skill) => skill.id)
      : [];
    return { updates: [], order };
  }

  const { group, index, neighborIndex } = located;
  const target = group[index];
  const neighbor = group[neighborIndex];

  const moved = group.slice();
  moved[index] = neighbor;
  moved[neighborIndex] = target;
  const order = moved.map((skill) => skill.id);

  if (target.display_order !== neighbor.display_order && swapKeepsOrder(moved, target, neighbor)) {
    return {
      updates: [
        { id: target.id, display_order: neighbor.display_order },
        { id: neighbor.id, display_order: target.display_order },
      ],
      order,
    };
  }

  if (moved.length > MAX_DISPLAY_ORDER + 1) {
    throw new RangeError(
      `Cannot renumber a category of ${moved.length} skills within 0-${MAX_DISPLAY_ORDER}`,
    );
  }

  const updates = [];
  moved.forEach((skill, position) => {
    if (skill.display_order !== position) updates.push({ id: skill.id, display_order: position });
  });
  return { updates, order };
}

/** True when swapping the two values and re-sorting like the server yields `moved`. */
function swapKeepsOrder(moved, target, neighbor) {
  const swapped = moved.map((skill) => {
    if (skill === target) return { ...skill, display_order: neighbor.display_order };
    if (skill === neighbor) return { ...skill, display_order: target.display_order };
    return skill;
  });
  const resorted = swapped.slice().sort(compareSkills);
  return resorted.every((skill, position) => skill.id === moved[position].id);
}
