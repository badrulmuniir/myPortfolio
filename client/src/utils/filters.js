// List helpers for the public Projects (25.5, 25.6) and Skills (24.1) pages.
// Pure functions: they never mutate their input and never re-sort the API order of items.

/** Key of the "All" filter control. `filterProjects` also treats null/undefined as "All". */
export const ALL_FILTER_KEY = 'all';
export const ALL_FILTER_LABEL = 'All';

/** Comparison form of a category: trimmed and lowercased; '' for missing or non-string values. */
export const categoryKey = (category) =>
  typeof category === 'string' ? category.trim().toLowerCase() : '';

/**
 * Builds the filter controls for the Projects page.
 *
 * Returns `[{ key: 'all', label: 'All' }, ...categories]` where each category entry is
 * `{ key, label }`: `key` is the trimmed, lowercased category and `label` is the trimmed
 * spelling of the first project (in API order) with that category. Category entries are
 * sorted alphabetically by label, compared case-insensitively.
 *
 * The "All" control is included here so every page gets the same first control. Returns
 * [] for an empty or non-array list, because the page shows no controls then (25.8).
 * Projects with an empty category, or a category equal to "all" ignoring case, add no
 * control of their own: they are only reachable through "All", which already lists them.
 */
export function deriveFilters(projects) {
  if (!Array.isArray(projects) || projects.length === 0) return [];

  const labels = new Map();
  for (const project of projects) {
    const key = categoryKey(project?.category);
    if (key === '' || key === ALL_FILTER_KEY || labels.has(key)) continue;
    labels.set(key, project.category.trim());
  }

  const categories = [...labels].map(([key, label]) => ({ key, label }));
  // Keys are already the lowercased labels and are unique, so this order is total.
  categories.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return [{ key: ALL_FILTER_KEY, label: ALL_FILTER_LABEL }, ...categories];
}

/**
 * Returns the projects shown for the selected filter key, keeping API order.
 * A key of null, undefined or 'all' returns every project; any other key returns the
 * projects whose category matches it case-insensitively (surrounding spaces ignored).
 * Always returns a new array.
 */
export function filterProjects(projects, key) {
  if (!Array.isArray(projects)) return [];
  if (key === null || key === undefined) return projects.slice();

  const selected = categoryKey(key);
  if (selected === ALL_FILTER_KEY) return projects.slice();
  return projects.filter((project) => categoryKey(project?.category) === selected);
}

/**
 * Groups skills by their exact category value: `[{ category, skills }]`.
 * Groups follow the order in which each category first appears, skills within a group
 * keep their API order, and every skill appears exactly once. Returns [] for an empty
 * or non-array list.
 */
export function groupSkills(skills) {
  if (!Array.isArray(skills)) return [];

  const groups = new Map();
  for (const skill of skills) {
    const category = skill?.category;
    let group = groups.get(category);
    if (!group) {
      group = { category, skills: [] };
      groups.set(category, group);
    }
    group.skills.push(skill);
  }
  return [...groups.values()];
}
