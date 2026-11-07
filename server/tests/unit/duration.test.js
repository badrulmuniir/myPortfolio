import { describe, expect, it } from 'vitest';
import { DEFAULT_JWT_EXPIRES_IN_SECONDS, parseDurationSeconds } from '../../src/utils/duration.js';

describe('parseDurationSeconds', () => {
  it('uses a 2-hour default', () => {
    expect(DEFAULT_JWT_EXPIRES_IN_SECONDS).toBe(7200);
  });

  it.each([
    ['120', 120],
    ['1', 1],
    ['90s', 90],
    ['15m', 900],
    ['2h', 7200],
    ['7d', 604800],
    ['007', 7],
  ])('parses %s as %i seconds', (input, expected) => {
    expect(parseDurationSeconds(input)).toBe(expected);
  });

  it.each([
    ['0'],
    ['0h'],
    [''],
    ['-5'],
    ['1.5h'],
    ['2H'],
    ['2 h'],
    [' 2h'],
    ['h'],
    ['2w'],
    ['2hh'],
    ['99999999999999999999d'],
  ])('rejects %j', (input) => {
    expect(parseDurationSeconds(input)).toBeNull();
  });

  it('rejects non-string values', () => {
    expect(parseDurationSeconds(120)).toBeNull();
    expect(parseDurationSeconds(undefined)).toBeNull();
  });
});
