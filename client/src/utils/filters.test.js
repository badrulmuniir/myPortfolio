import { describe, expect, it } from 'vitest';
import { ALL_FILTER_KEY, deriveFilters, filterProjects, groupSkills } from './filters.js';

const project = (id, category) => ({ id, slug: `p-${id}`, category });

describe('deriveFilters', () => {
  it('returns no controls for an empty or missing list', () => {
    expect(deriveFilters([])).toEqual([]);
    expect(deriveFilters(undefined)).toEqual([]);
  });

  it('puts All first, then one control per category compared case-insensitively', () => {
    const projects = [
      project(1, 'Web'),
      project(2, 'mobile'),
      project(3, 'WEB'),
      project(4, ' web '),
      project(5, 'Mobile'),
    ];
    expect(deriveFilters(projects)).toEqual([
      { key: 'all', label: 'All' },
      { key: 'mobile', label: 'mobile' },
      { key: 'web', label: 'Web' },
    ]);
  });

  it('labels each control with the first spelling in API order, trimmed', () => {
    const filters = deriveFilters([project(1, '  backEnd '), project(2, 'Backend')]);
    expect(filters[1]).toEqual({ key: 'backend', label: 'backEnd' });
  });

  it('sorts labels alphabetically ignoring case', () => {
    const projects = [project(1, 'zeta'), project(2, 'Alpha'), project(3, 'beta'), project(4, 'Gamma')];
    expect(deriveFilters(projects).map((f) => f.label)).toEqual(['All', 'Alpha', 'beta', 'Gamma', 'zeta']);
  });

  it('adds no control for empty categories or a category named "all"', () => {
    const projects = [project(1, ''), project(2, 'ALL'), project(3, 'Tools'), project(4, null)];
    expect(deriveFilters(projects)).toEqual([
      { key: 'all', label: 'All' },
      { key: 'tools', label: 'Tools' },
    ]);
  });

  it('does not mutate the input', () => {
    const projects = [project(1, 'b'), project(2, 'a')];
    const copy = structuredClone(projects);
    deriveFilters(projects);
    expect(projects).toEqual(copy);
  });
});

describe('filterProjects', () => {
  const projects = [
    project(1, 'Web'),
    project(2, 'Mobile'),
    project(3, 'web'),
    project(4, 'Data'),
    project(5, 'WEB '),
  ];

  it('returns every project in API order for All', () => {
    for (const key of [null, undefined, ALL_FILTER_KEY, 'ALL']) {
      const result = filterProjects(projects, key);
      expect(result).toEqual(projects);
      expect(result).not.toBe(projects);
    }
  });

  it('keeps matching projects case-insensitively in API order', () => {
    expect(filterProjects(projects, 'web').map((p) => p.id)).toEqual([1, 3, 5]);
    expect(filterProjects(projects, 'Mobile').map((p) => p.id)).toEqual([2]);
  });

  it('works with every key produced by deriveFilters', () => {
    for (const { key } of deriveFilters(projects)) {
      const ids = filterProjects(projects, key).map((p) => p.id);
      const expected = projects
        .filter((p) => key === 'all' || p.category.trim().toLowerCase() === key)
        .map((p) => p.id);
      expect(ids).toEqual(expected);
    }
  });

  it('returns an empty list for an unknown category or missing list', () => {
    expect(filterProjects(projects, 'games')).toEqual([]);
    expect(filterProjects(undefined, 'web')).toEqual([]);
  });
});

describe('groupSkills', () => {
  const skill = (id, category) => ({ id, name: `s${id}`, category });

  it('returns no groups for an empty or missing list', () => {
    expect(groupSkills([])).toEqual([]);
    expect(groupSkills(null)).toEqual([]);
  });

  it('orders groups by first appearance and keeps API order inside each group', () => {
    const skills = [
      skill(1, 'Frontend'),
      skill(2, 'Backend'),
      skill(3, 'Frontend'),
      skill(4, 'Tools'),
      skill(5, 'Backend'),
      skill(6, 'Frontend'),
    ];
    const groups = groupSkills(skills);
    expect(groups.map((g) => g.category)).toEqual(['Frontend', 'Backend', 'Tools']);
    expect(groups.map((g) => g.skills.map((s) => s.id))).toEqual([[1, 3, 6], [2, 5], [4]]);
  });

  it('includes every skill exactly once', () => {
    const skills = [skill(1, 'A'), skill(2, 'B'), skill(3, 'A'), skill(4, 'C')];
    const ids = groupSkills(skills).flatMap((g) => g.skills.map((s) => s.id));
    expect(ids.sort()).toEqual([1, 2, 3, 4]);
  });

  it('groups by the exact category value', () => {
    const groups = groupSkills([skill(1, 'Cloud'), skill(2, 'cloud')]);
    expect(groups.map((g) => g.category)).toEqual(['Cloud', 'cloud']);
  });
});
