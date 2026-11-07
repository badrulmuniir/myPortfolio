// Consistency checks for the static-host configuration examples (Requirements 36.1, 37.8):
// client/public/_redirects and _headers (Netlify), client/deploy/vercel.json and
// client/deploy/nginx.conf must give the same SPA fallback, headers and CSP.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(clientDir, path), 'utf8');

const withoutComments = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

function netlifyHeaders() {
  const lines = withoutComments(read('public/_headers'));
  expect(lines[0]).toBe('/*');
  return Object.fromEntries(
    lines.slice(1).map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    }),
  );
}

function vercelConfig() {
  return JSON.parse(read('deploy/vercel.json'));
}

function nginxHeaders() {
  const headers = {};
  for (const match of read('deploy/nginx.conf').matchAll(/^\s*add_header\s+(\S+)\s+"([^"]*)"\s+always;/gm)) {
    headers[match[1]] = match[2];
  }
  return headers;
}

const EXPECTED_NAMES = [
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'Permissions-Policy',
];

describe('static-host deployment configuration', () => {
  it('rewrites every path to index.html with status 200', () => {
    expect(withoutComments(read('public/_redirects'))).toEqual(['/*    /index.html    200']);
    expect(vercelConfig().rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
    expect(read('deploy/nginx.conf')).toMatch(/location \/ \{\s*try_files \$uri \$uri\/ \/index\.html;\s*\}/);
  });

  it('sends the same security headers from every host example', () => {
    const netlify = netlifyHeaders();
    const vercelEntries = vercelConfig().headers;
    expect(vercelEntries).toHaveLength(1);
    expect(vercelEntries[0].source).toBe('/(.*)');
    const vercel = Object.fromEntries(vercelEntries[0].headers.map(({ key, value }) => [key, value]));
    const { 'Strict-Transport-Security': hsts, ...nginx } = nginxHeaders();

    expect(Object.keys(netlify)).toEqual(EXPECTED_NAMES);
    expect(vercel).toEqual(netlify);
    expect(nginx).toEqual(netlify);
    expect(hsts).toMatch(/^max-age=\d+/);

    expect(netlify['X-Content-Type-Options']).toBe('nosniff');
    expect(netlify['X-Frame-Options']).toBe('DENY');
    expect(netlify['Referrer-Policy']).toBe('no-referrer');
  });

  it('uses a CSP that allows the API origin and https images and nothing inline', () => {
    const csp = netlifyHeaders()['Content-Security-Policy'];
    const directives = Object.fromEntries(
      csp
        .split(';')
        .map((part) => part.trim().split(/\s+/))
        .map(([name, ...values]) => [name, values]),
    );
    expect(directives['default-src']).toEqual(["'self'"]);
    expect(directives['script-src']).toEqual(["'self'"]);
    expect(directives['style-src']).toEqual(["'self'"]);
    expect(directives['img-src']).toEqual(expect.arrayContaining(['https:', 'data:']));
    expect(directives['connect-src']).toContain('https://api.example.com');
    expect(directives['frame-ancestors']).toEqual(["'none'"]);
    expect(directives['object-src']).toEqual(["'none'"]);
    expect(JSON.stringify(directives)).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  it('contains no loopback host, so the production build check stays clean', () => {
    for (const file of ['public/_redirects', 'public/_headers', 'deploy/vercel.json', 'deploy/nginx.conf']) {
      expect(read(file)).not.toMatch(/localhost|127\.0\.0\.1/i);
    }
  });
});
