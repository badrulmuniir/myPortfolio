import { describe, it, expect } from 'vitest';
import { canMove, compareSkills, computeSkillMove, MAX_DISPLAY_ORDER } from './reorder.js';

const skill = (id, category, display_order, name = `skill-${id}`) => ({
  id,
  name,
  category,
  display_order,
  proficiency_level: '',
  icon_url: '',
});

/** Applies the updates and re-sorts the whole list the way GET /api/skills does. */
const applyAndSort = (skills, updates) => {
  const values = new Map(updates.map((u) => [u.id, u.display_order]));
  return skills
    .map((s) => (values.has(s.id) ? { ...s, display_order: values.get(s.id) } : s))
    .sort(compareSkills);
};

const groupIds = (skills, category) =>
  skills.filter((s) => s.category === category).map((s) => s.id);

const deepCopy = (value) => JSON.parse(JSON.stringify(value));

// Server order: lower(category), display_order, lower(name), id.
const list = [
  skill(1, 'Backend', 0, 'Node'),
  skill(2, 'Backend', 1, 'Express'),
  skill(3, 'Backend', 2, 'Postgres'),
  skill(4, 'Frontend', 0, 'React'),
  skill(5, 'Frontend', 5, 'CSS'),
];

describe('computeSkillMove: different values', () => {
  it('swaps the two display_order values when moving down', () => {
    const result = computeSkillMove(list, 1, 'down');
    expect(result.updates).toEqual([
      { id: 1, display_order: 1 },
      { id: 2, display_order: 0 },
    ]);
    expect(result.order).toEqual([2, 1, 3]);
  });

  it('swaps the two display_order values when moving up', () => {
    const result = computeSkillMove(list, 5, 'up');
    expect(result.updates).toEqual([
      { id: 5, display_order: 0 },
      { id: 4, display_order: 5 },
    ]);
    expect(result.order).toEqual([5, 4]);
  });

  it('renumbers when a plain swap would be undone by the name tie-break', () => {
    // A and B share 1; moving C (2) up must give A, C, B. Swapping C<->B gives C=1,
    // which the name tie-break would sort before A ("a" < "b").
    const skills = [
      skill(1, 'Tools', 1, 'b-first'),
      skill(2, 'Tools', 1, 'c-second'),
      skill(3, 'Tools', 2, 'a-third'),
    ];
    const result = computeSkillMove(skills, 3, 'up');
    expect(result.order).toEqual([1, 3, 2]);
    expect(result.updates).toEqual([
      { id: 1, display_order: 0 },
      { id: 3, display_order: 1 },
      { id: 2, display_order: 2 },
    ]);
    expect(groupIds(applyAndSort(skills, result.updates), 'Tools')).toEqual(result.order);
  });
});

describe('computeSkillMove: equal values', () => {
  it('renumbers the category 0..n-1 in the moved order and lists only changed skills', () => {
    const skills = [
      skill(1, 'Database', 0, 'A'),
      skill(2, 'Database', 1, 'B'),
      skill(3, 'Database', 1, 'C'),
      skill(4, 'Database', 3, 'D'),
    ];
    const result = computeSkillMove(skills, 3, 'up');
    expect(result.order).toEqual([1, 3, 2, 4]);
    // 1 keeps 0, 3 keeps 1, 2 goes 1 -> 2, 4 keeps 3.
    expect(result.updates).toEqual([{ id: 2, display_order: 2 }]);
    expect(groupIds(applyAndSort(skills, result.updates), 'Database')).toEqual(result.order);
  });

  it('renumbers an all-equal category', () => {
    const skills = [skill(1, 'X', 7, 'a'), skill(2, 'X', 7, 'b'), skill(3, 'X', 7, 'c')];
    const result = computeSkillMove(skills, 1, 'down');
    expect(result.order).toEqual([2, 1, 3]);
    expect(result.updates).toEqual([
      { id: 2, display_order: 0 },
      { id: 1, display_order: 1 },
      { id: 3, display_order: 2 },
    ]);
  });
});

describe('computeSkillMove: no move', () => {
  it('returns no updates for the first skill moving up and the last moving down', () => {
    expect(computeSkillMove(list, 1, 'up')).toEqual({ updates: [], order: [1, 2, 3] });
    expect(computeSkillMove(list, 3, 'down')).toEqual({ updates: [], order: [1, 2, 3] });
    expect(computeSkillMove(list, 4, 'up').updates).toEqual([]);
  });

  it('returns no updates for an unknown id, unknown direction or non-array list', () => {
    expect(computeSkillMove(list, 99, 'up')).toEqual({ updates: [], order: [] });
    expect(computeSkillMove(list, 2, 'sideways').updates).toEqual([]);
    expect(computeSkillMove(null, 1, 'down')).toEqual({ updates: [], order: [] });
  });
});

describe('computeSkillMove: grouping', () => {
  it('treats categories that differ only in case as separate groups', () => {
    // Server order interleaves them by lower(category), display_order.
    const skills = [
      skill(1, 'Database', 0, 'Postgres'),
      skill(2, 'database', 1, 'Redis'),
      skill(3, 'Database', 2, 'MySQL'),
    ];
    expect(canMove(skills, 1, 'down')).toBe(true);
    expect(canMove(skills, 2, 'up')).toBe(false);
    expect(canMove(skills, 2, 'down')).toBe(false);

    const result = computeSkillMove(skills, 3, 'up');
    expect(result.order).toEqual([3, 1]);
    expect(result.updates).toEqual([
      { id: 3, display_order: 0 },
      { id: 1, display_order: 2 },
    ]);
    expect(groupIds(applyAndSort(skills, result.updates), 'Database')).toEqual([3, 1]);
  });

  it('never updates skills in other categories', () => {
    const result = computeSkillMove(list, 2, 'down');
    const ids = result.updates.map((u) => u.id);
    expect(ids.every((id) => [1, 2, 3].includes(id))).toBe(true);
    const sorted = applyAndSort(list, result.updates);
    expect(groupIds(sorted, 'Frontend')).toEqual([4, 5]);
    expect(groupIds(sorted, 'Backend')).toEqual([1, 3, 2]);
  });
});

describe('computeSkillMove: purity and bounds', () => {
  it('does not mutate the input list or its skills', () => {
    const skills = [skill(1, 'X', 2, 'a'), skill(2, 'X', 2, 'b'), skill(3, 'X', 4, 'c')];
    const before = deepCopy(skills);
    const refs = skills.slice();
    computeSkillMove(skills, 2, 'up');
    computeSkillMove(skills, 2, 'down');
    expect(skills).toEqual(before);
    skills.forEach((s, i) => expect(s).toBe(refs[i]));
  });

  it('keeps renumbered values within 0-9999 for a category of 10000 skills', () => {
    const skills = Array.from({ length: MAX_DISPLAY_ORDER + 1 }, (_, i) =>
      skill(i + 1, 'Big', 0, `s${String(i).padStart(5, '0')}`),
    );
    const { updates } = computeSkillMove(skills, 1, 'down');
    expect(Math.max(...updates.map((u) => u.display_order))).toBe(MAX_DISPLAY_ORDER);
    expect(Math.min(...updates.map((u) => u.display_order))).toBeGreaterThanOrEqual(0);
  });

  it('throws a RangeError when a category needs renumbering beyond 9999', () => {
    const skills = Array.from({ length: MAX_DISPLAY_ORDER + 2 }, (_, i) => skill(i + 1, 'Big', 0));
    expect(() => computeSkillMove(skills, 1, 'down')).toThrow(RangeError);
  });
});

describe('canMove', () => {
  it('is false at category edges and true elsewhere', () => {
    expect(canMove(list, 1, 'up')).toBe(false);
    expect(canMove(list, 1, 'down')).toBe(true);
    expect(canMove(list, 2, 'up')).toBe(true);
    expect(canMove(list, 3, 'down')).toBe(false);
    expect(canMove(list, 4, 'up')).toBe(false);
    expect(canMove(list, 5, 'down')).toBe(false);
    expect(canMove(list, 99, 'up')).toBe(false);
  });
});
