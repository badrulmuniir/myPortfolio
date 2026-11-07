import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const SHEETS = ['tokens.css', 'base.css', 'layout.css', 'components.css', 'admin.css'];
const css = Object.fromEntries(SHEETS.map((name) => [name, read(`./${name}`)]));

// Page-level sheets (styles/pages/*.css) follow the same token and breakpoint rules.
// Built from import.meta.url at runtime: Vite rewrites a literal `new URL('./dir/', import.meta.url)`.
const PAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'pages');
const PAGE_SHEETS = readdirSync(PAGES_DIR)
  .filter((file) => file.endsWith('.css'))
  .map((file) => `pages/${file}`);
for (const name of PAGE_SHEETS) css[name] = read(`./${name}`);
const ALL_SHEETS = [...SHEETS, ...PAGE_SHEETS];

// WCAG 2.1 relative luminance and contrast ratio.
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function colorTokens(source) {
  const tokens = new Map();
  for (const [, name, hex] of source.matchAll(/(--color-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens.set(name, hex.toLowerCase());
  }
  return tokens;
}

function contrastAnnotations(source) {
  const pattern = /@contrast\s+(--[\w-]+)\s+on\s+(--[\w-]+)\s*:\s*([\d.]+)\s*\(min\s*([\d.]+)\)/g;
  return [...source.matchAll(pattern)].map(([, fg, bg, documented, min]) => ({
    fg,
    bg,
    documented: Number(documented),
    min: Number(min),
  }));
}

describe('tokens.css contrast annotations', () => {
  const tokens = colorTokens(css['tokens.css']);
  const pairs = contrastAnnotations(css['tokens.css']);

  it('documents the core text, boundary and focus pairs', () => {
    const keys = new Set(pairs.map((p) => `${p.fg} on ${p.bg}`));
    for (const key of [
      '--color-text on --color-bg',
      '--color-text-muted on --color-bg',
      '--color-accent on --color-bg',
      '--color-on-accent on --color-accent',
      '--color-border on --color-bg',
      '--color-focus on --color-bg',
      '--color-error on --color-bg',
      '--color-inverse-text on --color-inverse-bg',
      '--color-focus-inverse on --color-inverse-bg',
    ]) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it.each(pairs.map((p) => [`${p.fg} on ${p.bg}`, p]))(
    '%s matches its documented ratio and meets its threshold',
    (_label, { fg, bg, documented, min }) => {
      expect(tokens.has(fg), `${fg} is defined`).toBe(true);
      expect(tokens.has(bg), `${bg} is defined`).toBe(true);
      const ratio = contrastRatio(tokens.get(fg), tokens.get(bg));
      expect(Math.abs(ratio - documented)).toBeLessThanOrEqual(0.01);
      expect([3, 4.5]).toContain(min);
      expect(ratio).toBeGreaterThanOrEqual(min);
    },
  );

  it('computes known WCAG reference ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('every color variable used by a stylesheet is defined in tokens.css', () => {
    for (const name of ALL_SHEETS) {
      for (const [, used] of css[name].matchAll(/var\((--color-[\w-]+)/g)) {
        expect(tokens.has(used), `${name} uses undefined ${used}`).toBe(true);
      }
    }
  });
});

describe('global CSS rules', () => {
  it('uses only the 768px and 1024px breakpoints', () => {
    for (const name of ALL_SHEETS) {
      for (const [, query] of css[name].matchAll(/@media\s*\(\s*((?:min|max)-width:\s*[\d.]+px)\s*\)/g)) {
        expect(['min-width: 768px', 'min-width: 1024px', 'max-width: 767.98px'], name).toContain(query);
      }
    }
  });

  it('page sheets use color tokens, not raw color values', () => {
    expect(PAGE_SHEETS.length).toBeGreaterThan(0);
    for (const name of PAGE_SHEETS) {
      const source = css[name].replace(/\/\*[\s\S]*?\*\//g, '');
      expect(source, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/);
    }
  });

  it('keeps images inside their container with their aspect ratio', () => {
    expect(css['base.css']).toMatch(/img,[^{]*\{[^}]*max-width:\s*100%;[^}]*height:\s*auto;/);
  });

  it('wraps long unbroken strings', () => {
    expect(css['base.css']).toMatch(/body\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  });

  it('shows a 3px focus-visible outline', () => {
    expect(css['tokens.css']).toMatch(/--focus-width:\s*3px;/);
    expect(css['base.css']).toMatch(/:focus-visible\s*\{[^}]*outline:\s*var\(--focus-width\) solid var\(--color-focus\);/);
  });

  it('disables animations and transitions for reduced motion', () => {
    expect(css['base.css']).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none !important;[\s\S]*transition:\s*none !important;/,
    );
  });

  it('defines the accessibility helper and honeypot classes', () => {
    expect(css['base.css']).toMatch(/\.visually-hidden,/);
    expect(css['base.css']).toMatch(/\.skip-link\s*\{/);
    expect(css['components.css']).toMatch(/\.hp-field\s*\{[^}]*position:\s*absolute;[^}]*left:\s*-10000px;/);
  });

  it('gives interactive elements 44px targets below 768px', () => {
    expect(css['tokens.css']).toMatch(/--tap-target:\s*44px;/);
    expect(css['components.css']).toMatch(/@media \(max-width: 767\.98px\)\s*\{[\s\S]*min-height:\s*var\(--tap-target\)/);
  });

  it('lets wide admin tables scroll inside their container', () => {
    expect(css['admin.css']).toMatch(/\.table-scroll\s*\{[^}]*overflow-x:\s*auto;/);
  });

  it('switches the projects grid to 2 and 3 equal columns at the breakpoints', () => {
    const layout = css['layout.css'];
    expect(layout).toMatch(/\.grid--projects\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--cols\), minmax\(0, 1fr\)\);/);
    expect(layout).toMatch(/@media \(min-width: 768px\)\s*\{[\s\S]*?\.grid--projects\s*\{\s*--cols:\s*2;/);
    expect(layout).toMatch(/@media \(min-width: 1024px\)\s*\{[\s\S]*?\.grid--projects\s*\{\s*--cols:\s*3;/);
  });
});

describe('main.jsx stylesheet imports', () => {
  const main = read('../main.jsx');
  const imports = [...main.matchAll(/^import\s+['"]\.\/styles\/([^'"]+)['"];?\s*$/gm)].map((m) => m[1]);

  it('imports each global sheet exactly once, tokens first', () => {
    expect(imports).toEqual(SHEETS);
  });

  it('does not import page-level sheets', () => {
    expect(main).not.toMatch(/styles\/pages\//);
  });
});
