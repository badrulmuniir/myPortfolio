import { defineConfig } from 'vitest/config';

// Two projects (Requirement 38.11):
// - `unit`: tests/unit, no Database needed.
// - `db`: tests/integration and tests/property, run against the PostgreSQL database in
//   TEST_DATABASE_URL. Its globalSetup migrates that database once and fails the run when the
//   database cannot be reached, so database tests never pass silently.
//
// `npm test` runs both projects. `npm run test:unit` (vitest run --project unit) runs only the
// unit project and needs no Database.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    // Test files share one PostgreSQL test database, so they run one at a time (38.11).
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.js'] },
      },
      {
        extends: true,
        test: {
          name: 'db',
          include: ['tests/integration/**/*.test.js', 'tests/property/**/*.test.js'],
          globalSetup: ['./tests/globalSetup.js'],
          fileParallelism: false,
        },
      },
    ],
  },
});
