import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  SLUG_MAX,
  SLUG_RE,
  deriveSlug,
  generateUniqueSlug,
  isSlug,
  slugify,
  truncate,
} from '../../src/utils/slug.js';

describe('constants', () => {
  it('exports the Slug format and limit', () => {
    expect(SLUG_MAX).toBe(160);
    expect(SLUG_RE.source).toBe('^[a-z0-9]+(?:-[a-z0-9]+)*$');
  });
});

describe('isSlug', () => {
  it.each([
    'portfolio-management-system',
    'a',
    'project-2024',
    '2024-recap',
    'a1b2',
    'x'.repeat(160),
  ])('accepts %j', (s) => {
    expect(isSlug(s)).toBe(true);
  });

  it.each([
    ['digits only', '2024'],
    ['digits with hyphen', '2024-2025'],
    ['empty', ''],
    ['double hyphen', 'a--b'],
    ['leading hyphen', '-abc'],
    ['trailing hyphen', 'abc-'],
    ['uppercase', 'Abc'],
    ['space', 'a b'],
    ['underscore', 'a_b'],
    ['non-ASCII letter', 'café'],
    ['161 characters', 'x'.repeat(161)],
  ])('rejects %s', (_label, s) => {
    expect(isSlug(s)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isSlug(undefined)).toBe(false);
    expect(isSlug(null)).toBe(false);
    expect(isSlug(123)).toBe(false);
    expect(isSlug(['abc'])).toBe(false);
  });
});

describe('slugify', () => {
  it.each([
    ['Portfolio Management System!', 'portfolio-management-system'],
    ['  --C++ & Go--  ', 'c-go'],
    ['Hello   World', 'hello-world'],
    ['Café Déjà Vu', 'caf-d-j-vu'],
    ['İstanbul', 'i-stanbul'],
    ['Straße', 'stra-e'],
    ['!!!', ''],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('throws on a non-string title', () => {
    expect(() => slugify(undefined)).toThrow(TypeError);
  });
});

describe('truncate', () => {
  it('returns short input unchanged', () => {
    expect(truncate('abc-def', 7)).toBe('abc-def');
  });

  it('cuts at the last hyphen inside the limit', () => {
    expect(truncate('abc-def-ghi', 9)).toBe('abc-def');
  });

  it('keeps the cut when the limit falls on a hyphen boundary', () => {
    expect(truncate('abc-def-ghi', 7)).toBe('abc-def');
  });

  it('hard-cuts a string without hyphens inside the limit', () => {
    expect(truncate('abcdefghij', 4)).toBe('abcd');
  });
});

describe('deriveSlug', () => {
  it.each([
    ['Portfolio Management System!', 'portfolio-management-system'],
    ['  --C++ & Go--  ', 'c-go'],
    ['2024', 'project-2024'],
    ['2024 / 2025', 'project-2024-2025'],
    ['!!!', 'project'],
    ['', 'project'],
    ['日本語', 'project'],
  ])('%j → %j', (input, expected) => {
    expect(deriveSlug(input)).toBe(expected);
  });

  it('truncates a long title at a word boundary with no trailing hyphen', () => {
    const title = 'abcd '.repeat(40); // slugifies to 199 characters
    const slug = deriveSlug(title);
    expect(slug.length).toBe(159);
    expect(slug.endsWith('-')).toBe(false);
    expect(isSlug(slug)).toBe(true);
  });

  it('hard-cuts a long single word at 160 characters', () => {
    expect(deriveSlug('a'.repeat(300))).toBe('a'.repeat(160));
  });

  it('applies the letter check after truncation', () => {
    // The only letter sits beyond the 160-character limit.
    const slug = deriveSlug(`${'1'.repeat(200)} a`);
    expect(slug).toBe('project');
    expect(isSlug(slug)).toBe(true);
  });

  it('keeps project- plus digits within the limit', () => {
    const slug = deriveSlug(`${'12345 '.repeat(30)}`); // digits only, 179 characters
    expect(slug.startsWith('project-')).toBe(true);
    expect(slug.length).toBeLessThanOrEqual(160);
    expect(isSlug(slug)).toBe(true);
  });

  it('respects a reduced limit', () => {
    expect(deriveSlug('abc def ghi', 9)).toBe('abc-def');
    expect(deriveSlug('!!!', 3)).toBe('pro');
  });

  it('rejects an out-of-range limit', () => {
    expect(() => deriveSlug('abc', 0)).toThrow(RangeError);
    expect(() => deriveSlug('abc', 161)).toThrow(RangeError);
  });

  it.each([
    'portfolio-management-system',
    'project-2024',
    '2024-recap',
    'a',
    'c-go',
    `${'ab-'.repeat(53)}a`, // 160 characters
  ])('is idempotent on valid slug %j', (s) => {
    expect(isSlug(s)).toBe(true);
    expect(deriveSlug(s)).toBe(s);
  });
});

describe('generateUniqueSlug', () => {
  it('returns the derived slug when it is free', () => {
    expect(generateUniqueSlug('My App', new Set())).toBe('my-app');
    expect(generateUniqueSlug('My App')).toBe('my-app');
  });

  it('uses -2, then -3, as earlier slugs are taken', () => {
    const taken = new Set(['my-app']);
    expect(generateUniqueSlug('My App', taken)).toBe('my-app-2');
    taken.add('my-app-2');
    expect(generateUniqueSlug('My App', taken)).toBe('my-app-3');
  });

  it('uses the smallest free suffix when a gap exists', () => {
    const taken = new Set(['my-app', 'my-app-3']);
    expect(generateUniqueSlug('My App', taken)).toBe('my-app-2');
  });

  it('shrinks the base so the suffixed slug stays within 160 characters', () => {
    const title = 'a'.repeat(160);
    const slug = generateUniqueSlug(title, new Set(['a'.repeat(160)]));
    expect(slug).toBe(`${'a'.repeat(158)}-2`);
    expect(slug.length).toBe(160);
  });

  it('shrinks a multi-word base at a hyphen boundary', () => {
    const title = 'abcd '.repeat(40);
    const first = generateUniqueSlug(title, new Set());
    const second = generateUniqueSlug(title, new Set([first]));
    expect(second).toBe(`${first.slice(0, 154)}-2`);
    expect(second.length).toBeLessThanOrEqual(160);
    expect(isSlug(second)).toBe(true);
  });

  it('prefixes digit-only titles before adding the suffix', () => {
    expect(generateUniqueSlug('2024', new Set(['project-2024']))).toBe('project-2024-2');
    expect(generateUniqueSlug('!!!', new Set(['project']))).toBe('project-2');
  });

  it('accepts an array of taken slugs', () => {
    expect(generateUniqueSlug('My App', ['my-app'])).toBe('my-app-2');
  });

  it('finds a free slug after many collisions', () => {
    const taken = new Set(['x']);
    for (let k = 2; k <= 500; k++) taken.add(`x-${k}`);
    expect(generateUniqueSlug('x', taken)).toBe('x-501');
  });

  it('always produces a valid, unused slug (sanity check)', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme', maxLength: 200 }),
        fc.array(fc.string({ maxLength: 20 }), { maxLength: 5 }),
        (title, extra) => {
          const taken = new Set(extra);
          const slug = generateUniqueSlug(title, taken);
          expect(isSlug(slug)).toBe(true);
          expect(taken.has(slug)).toBe(false);
        },
      ),
    );
  });
});
