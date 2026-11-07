import { describe, expect, it } from 'vitest';
import { sanitizeText } from '../../src/utils/sanitize.js';

describe('sanitizeText', () => {
  it.each([
    ['U+0000', '\u0000'],
    ['U+0008', '\u0008'],
    ['U+000B', '\u000B'],
    ['U+000C', '\u000C'],
    ['U+000E', '\u000E'],
    ['U+001F', '\u001F'],
    ['U+007F', '\u007F'],
  ])('removes %s inside the text', (_label, ch) => {
    expect(sanitizeText(`a${ch}b`)).toBe('ab');
  });

  it('removes every character of the disallowed ranges and nothing next to them', () => {
    const removed = [];
    for (let cp = 0x00; cp <= 0x08; cp += 1) removed.push(cp);
    removed.push(0x0b, 0x0c);
    for (let cp = 0x0e; cp <= 0x1f; cp += 1) removed.push(cp);
    removed.push(0x7f);
    const input = `x${String.fromCodePoint(...removed)}y`;
    expect(sanitizeText(input)).toBe('xy');
  });

  it('keeps tab, line feed and carriage return inside the text', () => {
    expect(sanitizeText('a\tb\nc\r\nd')).toBe('a\tb\nc\r\nd');
  });

  it('keeps characters adjacent to the removed ranges', () => {
    // U+0020 (space) and U+007E (~) inside text, U+0080 (C1 control) is not in scope.
    expect(sanitizeText('a b~c\u0080d')).toBe('a b~c\u0080d');
  });

  it('trims after removing control characters', () => {
    expect(sanitizeText('\u0000  hi  ')).toBe('hi');
    expect(sanitizeText('  hi \u007F ')).toBe('hi');
    expect(sanitizeText('\n\t hello world \r\n')).toBe('hello world');
  });

  it('returns an empty string when only control characters and whitespace remain', () => {
    expect(sanitizeText('\u0001 \u0002\t\u001F')).toBe('');
    expect(sanitizeText('')).toBe('');
  });

  it('keeps emoji, astral and non-Latin characters intact', () => {
    const text = 'Hi 👋🏽 from 𝔘𝔫𝔦𝔠𝔬𝔡𝔢, Привет, こんにちは 👨‍👩‍👧';
    expect(sanitizeText(text)).toBe(text);
    expect(sanitizeText(`\u0007${text}\u0007`)).toBe(text);
  });

  it('leaves HTML and zero-width characters as submitted', () => {
    const html = '<script>alert("x")</script> &amp; <b>bold</b>';
    expect(sanitizeText(html)).toBe(html);
    expect(sanitizeText('a\u200Bb')).toBe('a\u200Bb');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['number', 42],
    ['boolean', true],
    ['array', ['\u0000a']],
  ])('returns non-string input (%s) unchanged', (_label, value) => {
    expect(sanitizeText(value)).toBe(value);
  });

  it('returns the same object for object input', () => {
    const obj = { name: '\u0000x' };
    expect(sanitizeText(obj)).toBe(obj);
    expect(obj.name).toBe('\u0000x');
  });

  it('is idempotent', () => {
    const once = sanitizeText(' \u0003 a\u0000\tb \u007F ');
    expect(once).toBe('a\tb');
    expect(sanitizeText(once)).toBe(once);
  });
});
