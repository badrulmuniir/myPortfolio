// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  findForbiddenStrings,
  findInitialScriptUrls,
  isAdminModule,
  isLocalhostUrl,
  staticClosure,
} from './check-build.js';
import { toProjectPath } from './buildReportPlugin.js';

describe('check-build helpers', () => {
  it('classifies admin modules by path', () => {
    expect(isAdminModule('src/pages/admin/LoginPage.jsx')).toBe(true);
    expect(isAdminModule('src/components/admin/DataTable.jsx')).toBe(true);
    expect(isAdminModule('src/routes/AdminApp.jsx')).toBe(true);
    expect(isAdminModule('src/pages/public/HomePage.jsx')).toBe(false);
    expect(isAdminModule('src/components/common/FormField.jsx')).toBe(false);
  });

  it('recognises localhost API URLs only', () => {
    expect(isLocalhostUrl('http://localhost:5050/api')).toBe(true);
    expect(isLocalhostUrl('http://127.0.0.1:5050/api')).toBe(true);
    expect(isLocalhostUrl('http://[::1]:5050/api')).toBe(true);
    expect(isLocalhostUrl('https://api.example.com/api')).toBe(false);
    expect(isLocalhostUrl('https://localhost.example.com/api')).toBe(false);
    expect(isLocalhostUrl(undefined)).toBe(false);
    expect(isLocalhostUrl('not a url')).toBe(false);
  });

  it('finds module scripts and modulepreload links in index.html', () => {
    const html =
      '<script type="module" crossorigin src="/assets/index-a.js"></script>' +
      '<link rel="modulepreload" crossorigin href="/assets/vendor-b.js">' +
      '<link rel="stylesheet" href="/assets/index-c.css">';
    expect(findInitialScriptUrls(html)).toEqual(['/assets/index-a.js', '/assets/vendor-b.js']);
  });

  it('follows static imports but not dynamic imports', () => {
    const chunks = [
      { fileName: 'a.js', imports: ['b.js'], dynamicImports: ['admin.js'] },
      { fileName: 'b.js', imports: ['c.js'], dynamicImports: [] },
      { fileName: 'c.js', imports: [], dynamicImports: [] },
      { fileName: 'admin.js', imports: ['c.js'], dynamicImports: [] },
    ];
    expect(staticClosure(['a.js'], chunks).sort()).toEqual(['a.js', 'b.js', 'c.js']);
  });

  it('reports secret names and localhost URLs, allowing only the bare parse-base literal', () => {
    const text = 'a="JWT_SECRET";new URL(p,`http://localhost`);b="http://localhost:5050/api";c="127.0.0.1";d=ADMIN_PASSWORD';
    const { hits, allowed } = findForbiddenStrings(text, { allowLocalhost: false });
    expect(hits.map((hit) => hit.term)).toEqual(['JWT_SECRET', 'ADMIN_PASSWORD', 'localhost', '127.0.0.1']);
    expect(allowed).toBe(1);

    const relaxed = findForbiddenStrings(text, { allowLocalhost: true });
    expect(relaxed.hits.map((hit) => hit.term)).toEqual(['JWT_SECRET', 'ADMIN_PASSWORD']);
  });

  it('normalises Rolldown module ids to root-relative paths', () => {
    const root = process.platform === 'win32' ? 'C:\\app\\client' : '/app/client';
    const id = process.platform === 'win32' ? 'C:\\app\\client\\src\\App.jsx?v=1' : '/app/client/src/App.jsx?v=1';
    expect(toProjectPath(root, id)).toBe('src/App.jsx');
    expect(toProjectPath(root, '\0vite/modulepreload-polyfill.js')).toBe('vite/modulepreload-polyfill.js');
  });
});
