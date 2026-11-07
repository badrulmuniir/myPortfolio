// Post-build checks for the production Frontend (Requirements 6.5, 35.2, 35.3, 35.4, 36.2).
//
// Usage: `npm run build:check` (runs `vite build`, then this script), or
// `node scripts/check-build.js` to check an existing client/dist. Node built-ins only.
// Exits 1 with a message per failed check, 0 with a short summary otherwise.
//
// 1. Admin code (35.2, 35.3). "Admin module" = any module under src/pages/admin/,
//    src/components/admin/ or src/routes/ (AdminApp and its route guards). The module list of
//    every chunk comes from the build report written by scripts/buildReportPlugin.js, which
//    records Rolldown's exact chunk -> module ids mapping (minified code and the Vite manifest
//    cannot tell which modules a chunk contains). No chunk loaded before first render may
//    contain an admin module, and src/routes/AdminApp.jsx must sit in a lazily loaded chunk.
//    The report is cross-checked against the JS files in dist so a stale report fails.
// 2. Initial JS size (35.4). "Loaded before first render" = the <script src> and
//    <link rel="modulepreload"> files referenced by dist/index.html plus their static-import
//    closure from the build report. Lazy chunks are not counted. Each file is gzipped with
//    node:zlib (default level) and the total must be <= 250 KB (250,000 bytes).
// 3. Forbidden strings (6.5, 36.2). Every file in dist is scanned for `JWT_SECRET` and
//    `ADMIN_PASSWORD`, and for `localhost` / `127.0.0.1` unless the VITE_API_BASE_URL used by
//    the build is itself a localhost URL. The value comes from the build report (what was
//    inlined); if VITE_API_BASE_URL is also set now and differs, the check fails because
//    dist would not match the environment. One library literal is allowed: React Router uses
//    the exact string literal "http://localhost" (no port, no path) as a dummy base for
//    `new URL()` parsing; it is never requested. Any other localhost text fails the check.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { BUILD_REPORT_PATH } from './buildReportPlugin.js';

export const INITIAL_JS_LIMIT_BYTES = 250_000;
export const ADMIN_ENTRY_MODULE = 'src/routes/AdminApp.jsx';
const ADMIN_MODULE_PREFIXES = ['src/pages/admin/', 'src/components/admin/', 'src/routes/'];
const SECRET_NAMES = ['JWT_SECRET', 'ADMIN_PASSWORD'];
const LOCALHOST_PATTERN = /localhost|127\.0\.0\.1/gi;
const MAX_HITS_PER_FILE = 5;

/** True for a root-relative module path that belongs to the Admin_Dashboard. */
export function isAdminModule(modulePath) {
  return ADMIN_MODULE_PREFIXES.some((prefix) => modulePath.startsWith(prefix));
}

/** True when `value` parses as a URL whose host is a loopback name or address. */
export function isLocalhostUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

function parseAttributes(source) {
  const attrs = {};
  const pattern = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

/**
 * URLs of the scripts index.html makes the browser load before the app renders:
 * every <script src> and every <link rel="modulepreload" href>, in document order.
 */
export function findInitialScriptUrls(html) {
  const urls = [];
  for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = parseAttributes(match[2]);
    if (tag === 'script' && attrs.src) urls.push(attrs.src);
    if (tag === 'link' && attrs.href && (attrs.rel ?? '').toLowerCase().split(/\s+/).includes('modulepreload')) {
      urls.push(attrs.href);
    }
  }
  return [...new Set(urls)];
}

function isAllowedLibraryLocalhost(text, index) {
  const prefix = 'http://';
  const start = index - prefix.length;
  if (start < 1 || text.slice(start, index) !== prefix) return false;
  const quote = text[start - 1];
  return (quote === '"' || quote === "'" || quote === '`') && text[index + 'localhost'.length] === quote;
}

function snippet(text, index, length) {
  const from = Math.max(0, index - 40);
  const to = Math.min(text.length, index + length + 40);
  return text.slice(from, to).replace(/\s+/g, ' ');
}

/**
 * Finds forbidden strings in `text`. Returns `{ hits, allowed }`: hits are
 * `{ term, index, snippet }`, `allowed` counts the tolerated "http://localhost" literals.
 * With `allowLocalhost`, localhost and 127.0.0.1 are not reported at all.
 */
export function findForbiddenStrings(text, { allowLocalhost }) {
  const hits = [];
  let allowed = 0;
  for (const name of SECRET_NAMES) {
    for (let i = text.indexOf(name); i !== -1; i = text.indexOf(name, i + 1)) {
      hits.push({ term: name, index: i, snippet: snippet(text, i, name.length) });
    }
  }
  if (!allowLocalhost) {
    for (const match of text.matchAll(LOCALHOST_PATTERN)) {
      if (match[0].toLowerCase() === 'localhost' && isAllowedLibraryLocalhost(text, match.index)) {
        allowed += 1;
      } else {
        hits.push({ term: match[0], index: match.index, snippet: snippet(text, match.index, match[0].length) });
      }
    }
  }
  return { hits, allowed };
}

/** Static-import closure of `start` over the report's chunks (file names relative to dist). */
export function staticClosure(start, chunks) {
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const seen = new Set();
  const queue = [...start];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const dep of byFile.get(file)?.imports ?? []) queue.push(dep);
  }
  return [...seen];
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

const toPosix = (value) => value.replace(/\\/g, '/');
const kb = (bytes) => `${(bytes / 1000).toFixed(2)} KB`;

/**
 * Runs every check against `distDir` using the build report at `reportPath`.
 * Returns `{ failures: string[], summary: string[] }`.
 */
export function runChecks({ distDir, reportPath, env = process.env }) {
  const failures = [];
  const summary = [];

  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    return { failures: [`${toPosix(indexPath)} not found. Run "vite build" first.`], summary };
  }
  if (!existsSync(reportPath)) {
    return {
      failures: [`Build report ${toPosix(reportPath)} not found. Rebuild with "vite build" (the build report plugin writes it).`],
      summary,
    };
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const chunks = report.chunks ?? [];

  // The report must describe exactly the JS files in dist.
  const distFiles = listFiles(distDir);
  const distJs = distFiles.map((file) => toPosix(relative(distDir, file))).filter((file) => file.endsWith('.js'));
  const reportJs = chunks.map((chunk) => chunk.fileName);
  const missing = reportJs.filter((file) => !distJs.includes(file));
  const extra = distJs.filter((file) => !reportJs.includes(file));
  if (resolve(report.outDir ?? '') !== resolve(distDir) || missing.length > 0 || extra.length > 0) {
    return {
      failures: [
        `The build report does not match ${toPosix(distDir)} (stale report or modified dist). ` +
          `Rebuild with "vite build". Missing in dist: ${missing.join(', ') || 'none'}; not in report: ${extra.join(', ') || 'none'}.`,
      ],
      summary,
    };
  }

  // Scripts loaded before first render.
  const html = readFileSync(indexPath, 'utf8');
  const htmlUrls = findInitialScriptUrls(html);
  const htmlFiles = [];
  for (const url of htmlUrls) {
    if (/^([a-z][a-z\d+.-]*:)?\/\//i.test(url)) {
      failures.push(`index.html loads an external script (${url}); its size cannot be measured.`);
      continue;
    }
    const file = toPosix(url.split(/[?#]/)[0]).replace(/^\.?\//, '');
    if (!reportJs.includes(file)) {
      failures.push(`index.html references ${url}, which is not a chunk of this build.`);
      continue;
    }
    htmlFiles.push(file);
  }
  const entryFiles = chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName);
  if (htmlFiles.length === 0) failures.push('index.html references no script chunk.');
  const initialFiles = staticClosure(htmlFiles, chunks);
  const initialSet = new Set(initialFiles);

  // 1. Admin code.
  for (const chunk of chunks.filter((c) => initialSet.has(c.fileName))) {
    const adminModules = chunk.modules.filter(isAdminModule);
    if (adminModules.length > 0) {
      failures.push(
        `Initial chunk ${chunk.fileName} contains admin modules (Requirement 35.2): ${adminModules.join(', ')}. ` +
          `Public code must reach the admin area only through the lazy import of ${ADMIN_ENTRY_MODULE}.`,
      );
    }
  }
  const adminChunks = chunks.filter((chunk) => chunk.modules.includes(ADMIN_ENTRY_MODULE));
  if (adminChunks.length === 0) {
    failures.push(`${ADMIN_ENTRY_MODULE} was not found in any chunk, so the admin check cannot be trusted.`);
  } else if (!adminChunks.every((chunk) => chunk.isDynamicEntry && !initialSet.has(chunk.fileName))) {
    failures.push(`${ADMIN_ENTRY_MODULE} is not in a lazily loaded chunk (Requirement 35.3).`);
  } else {
    summary.push(
      `admin code: none in ${initialFiles.length} initial chunk(s); ${ADMIN_ENTRY_MODULE} is lazy (${adminChunks
        .map((chunk) => chunk.fileName)
        .join(', ')})`,
    );
  }

  // 2. Initial JS size.
  let totalGzip = 0;
  const sizes = initialFiles.map((file) => {
    const bytes = gzipSync(readFileSync(join(distDir, file))).length;
    totalGzip += bytes;
    return `${file} ${kb(bytes)}`;
  });
  if (totalGzip > INITIAL_JS_LIMIT_BYTES) {
    failures.push(
      `JS loaded before first render is ${kb(totalGzip)} gzipped, over the ${kb(INITIAL_JS_LIMIT_BYTES)} limit (Requirement 35.4): ${sizes.join('; ')}.`,
    );
  } else {
    summary.push(`initial JS: ${kb(totalGzip)} gzipped of ${kb(INITIAL_JS_LIMIT_BYTES)} allowed (${sizes.join('; ')})`);
  }

  // 3. Forbidden strings.
  const builtUrl = report.apiBaseUrl;
  const currentUrl = env.VITE_API_BASE_URL;
  if (typeof currentUrl === 'string' && currentUrl !== '' && typeof builtUrl === 'string' && currentUrl !== builtUrl) {
    failures.push('VITE_API_BASE_URL differs from the value dist was built with. Rebuild with the same VITE_API_BASE_URL.');
  }
  const apiUrl = builtUrl ?? currentUrl;
  if (typeof apiUrl !== 'string' || apiUrl.trim() === '') {
    failures.push('VITE_API_BASE_URL used by the build is unknown; the localhost rule cannot be applied.');
  }
  const allowLocalhost = isLocalhostUrl(apiUrl);
  let allowedLiterals = 0;
  const stringFailures = [];
  for (const file of distFiles) {
    const { hits, allowed } = findForbiddenStrings(readFileSync(file, 'utf8'), { allowLocalhost });
    allowedLiterals += allowed;
    const name = toPosix(relative(distDir, file));
    for (const hit of hits.slice(0, MAX_HITS_PER_FILE)) {
      stringFailures.push(`${name}: "${hit.term}" at offset ${hit.index}: ...${hit.snippet}...`);
    }
    if (hits.length > MAX_HITS_PER_FILE) stringFailures.push(`${name}: ${hits.length - MAX_HITS_PER_FILE} more match(es)`);
  }
  if (stringFailures.length > 0) {
    failures.push(
      `Forbidden strings in the build output (Requirements 6.5, 36.2${allowLocalhost ? '' : '; localhost is not allowed because VITE_API_BASE_URL is not a localhost URL'}):\n    ${stringFailures.join('\n    ')}`,
    );
  } else {
    const localhostNote = allowLocalhost
      ? 'localhost/127.0.0.1 rule skipped (VITE_API_BASE_URL is a localhost URL)'
      : `no localhost/127.0.0.1 (${allowedLiterals} allowed React Router "http://localhost" URL-parse literal(s))`;
    summary.push(`strings: no JWT_SECRET or ADMIN_PASSWORD in ${distFiles.length} file(s); ${localhostNote}`);
  }

  summary.unshift(`entry: ${entryFiles.join(', ') || 'none'}`);
  return { failures, summary };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const invoked = resolve(process.argv[1]);
  return process.platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
}

if (isMainModule()) {
  const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const { failures, summary } = runChecks({ distDir, reportPath: BUILD_REPORT_PATH });
  if (failures.length > 0) {
    console.error(`build:check FAILED (${failures.length} problem(s)):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('build:check passed');
  for (const line of summary) console.log(`  - ${line}`);
}
