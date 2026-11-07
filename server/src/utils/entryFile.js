// Detects whether a module is the file Node was started with, so CLI modules can also be imported
// by tests without running.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** @param {string} moduleUrl the caller's `import.meta.url` */
export function isEntryFile(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    const self = fileURLToPath(moduleUrl);
    const entry = realpathSync(argv1);
    return process.platform === 'win32' ? self.toLowerCase() === entry.toLowerCase() : self === entry;
  } catch {
    return false;
  }
}
