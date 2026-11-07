import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { buildReportPlugin } from './scripts/buildReportPlugin.js';

const clientDir = dirname(fileURLToPath(import.meta.url));

// The production build needs the API base URL (Requirement 36.3). The check runs
// only for `vite build`, so `vite` (dev server) and `vitest` work without it.
// loadEnv reads client/.env* files; process.env wins so CI variables count.
// The error names the variable and never prints its value.
function assertApiBaseUrl(mode) {
  const fileEnv = loadEnv(mode, clientDir, 'VITE_');
  const value = process.env.VITE_API_BASE_URL ?? fileEnv.VITE_API_BASE_URL;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      'VITE_API_BASE_URL is unset or empty. Set VITE_API_BASE_URL to the API base URL including /api ' +
        '(see client/.env.example) before running the production build.',
    );
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    assertApiBaseUrl(mode);
  }

  return {
    // buildReportPlugin records each chunk's modules for scripts/check-build.js (build only).
    plugins: [react(), buildReportPlugin()],
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{js,jsx}', 'scripts/**/*.test.js'],
      setupFiles: ['./src/setupTests.js'],
    },
  };
});
