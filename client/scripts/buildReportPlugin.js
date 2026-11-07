// Vite plugin that records which source modules ended up in which output chunk, for
// scripts/check-build.js (Requirements 35.2, 35.3, 35.4).
//
// Minified chunks do not say which modules they contain, and the Vite manifest lists chunks
// but not their modules. Rolldown knows the exact module list of every chunk, so this plugin
// writes it to BUILD_REPORT_PATH after the bundle is written. The report lives in
// node_modules/.cache (ignored by git) instead of dist/, so it is never deployed.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const BUILD_REPORT_PATH = resolve(clientDir, 'node_modules/.cache/portfolio-build-report.json');

/**
 * Turns a Rolldown module id into a stable, root-relative path with forward slashes:
 * strips the virtual-module `\0` prefix and any query string, and keeps ids outside
 * the root (or virtual ids) as they are.
 */
export function toProjectPath(root, id) {
  const clean = id.replace(/^\0/, '').replace(/\?.*$/, '');
  if (!isAbsolute(clean)) return clean.replace(/\\/g, '/');
  const rel = relative(root, clean).replace(/\\/g, '/');
  return rel.startsWith('../') ? clean.replace(/\\/g, '/') : rel;
}

export function buildReportPlugin() {
  let root = clientDir;
  let outDir = resolve(clientDir, 'dist');
  let apiBaseUrl = null;

  return {
    name: 'portfolio-build-report',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
      // config.env holds the VITE_ values inlined into the bundle (.env files and process.env).
      apiBaseUrl = config.env.VITE_API_BASE_URL ?? null;
    },
    buildStart() {
      // A failed build must not leave an older report behind.
      rmSync(BUILD_REPORT_PATH, { force: true });
    },
    writeBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((output) => output.type === 'chunk')
        .map((chunk) => ({
          fileName: chunk.fileName,
          isEntry: chunk.isEntry,
          isDynamicEntry: chunk.isDynamicEntry,
          imports: [...chunk.imports],
          dynamicImports: [...chunk.dynamicImports],
          modules: chunk.moduleIds.map((id) => toProjectPath(root, id)),
        }));
      const report = { outDir, apiBaseUrl, chunks };
      mkdirSync(dirname(BUILD_REPORT_PATH), { recursive: true });
      writeFileSync(BUILD_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    },
  };
}
