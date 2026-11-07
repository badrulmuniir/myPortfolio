// Vitest setup file, run before every client test file.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import fc from 'fast-check';

// Vitest globals are off, so React Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
});

// Every property-based test runs at least 100 generated inputs (38.9).
fc.configureGlobal({ numRuns: 100 });
