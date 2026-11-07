import { describe, expect, it } from 'vitest';
import { URL_MAX_LENGTH, isValidUrl } from './url.js';

describe('isValidUrl', () => {
  it.each([
    'http://example.com',
    'https://example.com/path?q=1#frag',
    'https://sub.example.co.uk:8443/a',
    'http://localhost:5173',
    'https://127.0.0.1/x',
    'HTTPS://EXAMPLE.COM',
  ])('accepts %s', (value) => {
    expect(isValidUrl(value)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.com',
    'mailto:me@example.com',
    'file:///etc/passwd',
    '/relative/path',
    'example.com',
    '',
    'http://',
    'https://',
  ])('rejects %s', (value) => {
    expect(isValidUrl(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const value of [undefined, null, 42, {}, ['https://example.com']]) {
      expect(isValidUrl(value)).toBe(false);
    }
  });

  it('accepts exactly 2048 code points and rejects 2049', () => {
    const prefix = 'https://example.com/';
    const atLimit = prefix + 'a'.repeat(URL_MAX_LENGTH - prefix.length);
    expect([...atLimit].length).toBe(2048);
    expect(isValidUrl(atLimit)).toBe(true);
    expect(isValidUrl(`${atLimit}a`)).toBe(false);
  });

  it('counts an emoji as one code point', () => {
    const prefix = 'https://example.com/';
    const atLimit = prefix + '😀'.repeat(URL_MAX_LENGTH - prefix.length);
    expect(isValidUrl(atLimit)).toBe(true);
    expect(isValidUrl(`${atLimit}😀`)).toBe(false);
  });
});
