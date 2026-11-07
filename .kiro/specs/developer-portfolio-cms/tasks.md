# Implementation Plan: Developer Portfolio CMS

## Overview

This plan builds the Portfolio_System in JavaScript (ES modules), following the design: React + Vite in `client/`, Express 5 in `server/`, and PostgreSQL through `pg`. Each phase produces working, tested code that the next phase builds on:

1. Foundation: monorepo, configuration with startup validation, database pool, health endpoint and frontend-to-backend connectivity.
2. Database: SQL migrations, the Migration_Runner and the Seed_Script.
3. Backend core: errors, Error_Handler, security middleware, Validator, Slug_Generator and contact sanitizing.
4. Authentication: login, JWT, Auth_Middleware, Role_Guard, Rate_Limiter and `/auth/me`.
5. Resource APIs: profile, settings, projects with technologies, skills, experiences, education, contact and dashboard stats.
6. Frontend foundation: API_Client, Auth_Context, hooks, shared components, CSS, contexts, routing with a lazy admin bundle.
7. Public pages.
8. Admin dashboard pages and forms.
9. Accessibility, responsive and performance checks.
10. README and deployment configuration.

Server integration and property tests run against a real PostgreSQL test database from `TEST_DATABASE_URL`. Fakes are used only where the design calls for them (fake service layers for precedence and error-handler tests, an injected failing `db` for 500 tests, an injected clock and a low-cost hasher). Property-based tests use fast-check with at least 100 runs and carry the tag comment `// Feature: developer-portfolio-cms, Property N: <title>`.

The CORS middleware is built in the foundation phase instead of the backend core phase, because the Frontend cannot reach the API_Server across origins without it.

## Tasks

- [x] 1. Set up monorepo foundation and connectivity
  - [x] 1.1 Scaffold the monorepo, packages and environment files
    - Create root `package.json` (scripts only: `dev:client`, `dev:server`, `build`, `migrate`, `seed`, `test` delegating with `npm --prefix`)
    - Create `client/package.json` (React, React DOM, React Router DOM, Vite, Vitest, jsdom, React Testing Library, user-event, fast-check; no `pg` or other database driver) with `dev`, `build`, `test` (`vitest run`) scripts
    - Create `server/package.json` (`"type": "module"`, Express 5, pg, bcryptjs, jsonwebtoken, dotenv, cross-env, Vitest, Supertest, fast-check) with `dev`, `start` (`cross-env NODE_ENV=production`), `migrate`, `seed`, `test` (`vitest run`) scripts
    - Create the directory skeletons from the design: `server/src/{config,db,routes,controllers,services,middleware,validators,utils}`, `server/{migrations,scripts,tests}`, `client/src/{api,components,pages/public,pages/admin,context,hooks,routes,utils,styles,assets}`
    - Create root `.gitignore` excluding every `node_modules/`, `client/dist/` and every `.env*` file except `.env.example`
    - Create `server/.env.example` and `client/.env.example` with placeholder values for every variable in the design's Environment Variables tables
    - _Requirements: 1.1, 1.3, 1.4, 1.9, 1.10, 1.11, 9.4, 36.10, 38.12_

  - [x] 1.2 Configure test tooling for both layers
    - `server/vitest.config.js`: `environment: 'node'`, `fileParallelism: false`, a setup file calling `fc.configureGlobal({ numRuns: 100 })`
    - Add a guard in the server test setup that refuses to run when `TEST_DATABASE_URL` is unset or equals `DATABASE_URL`
    - Client Vitest configuration with `environment: 'jsdom'`, React Testing Library setup and the same fast-check global configuration
    - _Requirements: 38.9, 38.11, 38.12_

  - [x] 1.3 Implement configuration loading with startup validation
    - `server/src/utils/duration.js`: parse `JWT_EXPIRES_IN` (`^[0-9]+[smhd]?$`, value > 0) into seconds, default 7200
    - `server/src/config/env.js`: `loadAppConfig(env)` and `loadDbConfig(env)` covering `PORT`, `NODE_ENV`, `DATABASE_URL` precedence over `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`, `PGPORT` default 5432, `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED`, `DB_POOL_MAX` (1–100, default 10), `JWT_SECRET` (≥ 32 characters), `FRONTEND_URL` (normalized origin list), `TRUST_PROXY` and boolean parsing
    - Return or throw an error that names every invalid variable without including any value
    - _Requirements: 5.7, 5.9, 9.3, 9.8, 35.7, 35.8, 36.4, 36.5_

  - [ ]* 1.4 Write property test for the configuration loader
    - **Property 9: Configuration loader accepts exactly valid configurations**
    - Include the check that a token signed with `jsonwebtoken` using the parsed lifetime has `exp − iat` equal to that lifetime
    - **Validates: Requirements 5.7, 5.9, 9.3, 9.8, 35.7, 35.8, 36.4, 36.5**

  - [x] 1.5 Implement the database access layer and logger
    - `server/src/db/typeParsers.js` (DATE as `YYYY-MM-DD` string), `pool.js` (`createDb` with `max: DB_POOL_MAX`, `connectionTimeoutMillis: 5000`, `ssl` from `DB_SSL` and `DB_SSL_REJECT_UNAUTHORIZED`), `query.js` (async/await; acquire failure → service-unavailable error), `transaction.js` (`withTransaction` with BEGIN/COMMIT/ROLLBACK), `healthCheck` with a 5 s timeout
    - `server/src/db/startupCheck.js`: `startServer(app, { db, port })` runs `SELECT 1` within 10 s, logs failures without the password or full `DATABASE_URL`, exits 1, otherwise listens
    - `server/src/utils/logger.js` redacting `password`, `password_hash`, `token` and `authorization` keys
    - _Requirements: 1.7, 5.8, 9.3, 35.7, 35.9, 36.4, 36.6, 36.7_

  - [x] 1.6 Implement the app factory, entry file, CORS and health endpoint
    - `server/src/utils/response.js` with `ok(res, data, status, meta)` and an error-body helper producing Error_Responses
    - `server/src/middleware/cors.js`: exact origin matching against normalized `FRONTEND_URL`, `Vary: Origin`, preflight 204 with allow headers only for matching origins
    - `server/src/app.js`: `createApp({ config, db, clock, logger, hasher })`, `app.disable('x-powered-by')`, CORS, `/api` router from `routes/index.js`
    - `server/src/routes/health.routes.js`: `GET /api/health` → 200 Success_Response when the test query answers within 5 s, otherwise 503 Error_Response without connection details
    - `server/src/server.js` limited to loading configuration, creating the app and starting the listener
    - _Requirements: 1.6, 4.1, 9.2, 36.8, 36.9_

  - [ ]* 1.7 Write property test for CORS origin matching
    - **Property 29: CORS allow headers only for exactly matching origins**
    - **Validates: Requirements 9.2**

  - [ ]* 1.8 Write integration tests for the health endpoint
    - 200 against the test database; 503 with a failing or slow `db` stub, with no connection details in the body
    - _Requirements: 36.8, 36.9_

  - [x] 1.9 Scaffold the Frontend and connect it to the health endpoint
    - `client/vite.config.js`: fail `vite build` with an error naming `VITE_API_BASE_URL` when it is unset or empty
    - `client/index.html`, `src/main.jsx` (createRoot, BrowserRouter), placeholder `src/App.jsx` that shows the API status
    - `src/api/apiClient.js` with an initial `request(path)` that prefixes `import.meta.env.VITE_API_BASE_URL` and returns `data` from a Success_Response; `src/api/healthApi.js` with `getHealth()`
    - _Requirements: 1.2, 32.2, 36.1, 36.2, 36.3_

  - [ ]* 1.10 Write unit tests for Frontend connectivity
    - API_Client prefixes the base URL (mocked `fetch`); the Vite build check rejects an unset or empty `VITE_API_BASE_URL`
    - _Requirements: 32.2, 36.3_

- [x] 2. Checkpoint - Foundation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement database schema, Migration_Runner and Seed_Script
  - [x] 3.1 Write the SQL migration files
    - `server/migrations/001_init_functions.sql` to `010_create_settings.sql` exactly as in the design's Database Schema, including the `set_updated_at()` trigger on every table with `updated_at`, `TEXT[]` columns for `features` and `responsibilities`, check constraints, the `lower(name)` unique index on technologies, cascading foreign keys and the listing indexes
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.9, 2.10_

  - [x] 3.2 Implement the Migration_Runner
    - `server/src/db/migrator.js`: advisory lock, `schema_migrations` tracking table, files matching `^(\d{3,})_[a-z0-9_]+\.sql$` sorted by numeric version, one transaction per file, stop on first failure, "No pending migrations" report
    - `server/scripts/migrate.js` CLI wrapper with exit codes and a credential-free connection-failure message
    - _Requirements: 2.6, 2.7, 2.8, 2.11, 2.12_

  - [x] 3.3 Implement server test database helpers
    - Vitest `globalSetup` that runs the Migration_Runner against `TEST_DATABASE_URL`
    - `tests/helpers/testDb.js` with `resetDb()` (`TRUNCATE … RESTART IDENTITY CASCADE` on every table except `schema_migrations`) and a table snapshot helper; `tests/helpers/factories.js` for test records
    - _Requirements: 38.11_

  - [ ]* 3.4 Write integration tests for the schema and Migration_Runner
    - `information_schema`/`pg_indexes` checks for tables, columns, keys, unique constraints, indexes and timestamp defaults
    - Check-constraint rejections, case-insensitive Technology uniqueness, cascade behavior
    - Runner on an empty database, re-run with nothing pending, a fixture directory with a failing second file, an unreachable database
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.11, 2.12_

  - [x] 3.5 Implement the Seed_Script
    - `server/src/utils/password.js`: injectable hasher (`bcryptjs`, cost 12 by default) with `hash` and `compare`
    - `loadSeedConfig(env)` in `config/env.js`: validate `ADMIN_EMAIL` (Valid_Email) and `ADMIN_PASSWORD` (≥ 12 characters, ≤ 72 bytes), no defaults, name each invalid variable
    - `server/src/services/seedService.js`: one transaction with named steps `admin`, `profile`, `settings`, `sample`; skip admin creation when any admin exists; insert profile and the four settings defaults with `ON CONFLICT DO NOTHING`; sample content from `server/seed/sampleContent.js` only when `SEED_SAMPLE_CONTENT=true` and all four content tables are empty
    - `server/scripts/seed.js` CLI wrapper; the password never reaches any log or error output
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [ ]* 3.6 Write property test for seeding
    - **Property 28: Seeding is idempotent and validates its inputs**
    - Inject a cost-4 hasher to keep runs fast
    - **Validates: Requirements 3.2, 3.3, 3.4**

  - [ ]* 3.7 Write unit and integration tests for the Seed_Script
    - First run creates one admin with a bcrypt hash and role `admin`; sample content inserted and skipped; an injected failure rolls back every write and names the step; `ADMIN_PASSWORD` absent from captured stdout, stderr and logs
    - _Requirements: 3.1, 3.5, 3.6, 3.7, 3.8_

- [x] 4. Checkpoint - Database
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement backend core middleware and utilities
  - [x] 5.1 Implement domain errors, the Error_Handler and the not-found handler
    - `server/src/utils/errors.js`: classes with fixed status, code and message per the design's error mapping table (`INVALID_ID`, `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `SERVICE_UNAVAILABLE`, rate-limit codes)
    - `server/src/middleware/errorHandler.js`: map domain errors, body-parser errors and pg `23505` (constraint-name map to field) to Error_Responses; generic 500 for anything else; log method, `req.path`, message and stack with redaction; omit internals in production
    - `server/src/middleware/notFound.js` for unmatched `/api` routes; `process.on('unhandledRejection')` logging in `server.js`
    - Switch the health endpoint's 503 to `ServiceUnavailableError`
    - _Requirements: 1.8, 4.3, 4.4, 4.7, 4.8, 4.9, 4.11, 4.13, 9.9_

  - [ ]* 5.2 Write property test for the Error_Handler
    - **Property 13: Error responses are well-formed, code-stable and leak nothing in production**
    - **Validates: Requirements 4.9, 4.11, 4.13, 9.9**

  - [x] 5.3 Implement security headers, body size guard and JSON parsing
    - `server/src/middleware/securityHeaders.js` mounted first: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
    - `server/src/middleware/bodySizeGuard.js` (`Content-Length` > 102400 → 413) and `express.json({ limit: '100kb' })` with `MALFORMED_JSON` mapping
    - Wire the pipeline order in `app.js`: securityHeaders → cors → bodySizeGuard → express.json → `/api` router → notFound → errorHandler
    - _Requirements: 4.5, 4.6, 9.5, 9.10_

  - [ ]* 5.4 Write integration tests for the request pipeline
    - 413 at 102,401 bytes and acceptance at 102,400; malformed JSON → 400; security headers and no `X-Powered-By` on success, error, unknown-route and `OPTIONS` responses; unknown `/api` route → 404 `ROUTE_NOT_FOUND`
    - _Requirements: 4.4, 4.5, 4.6, 9.5, 9.10_

  - [x] 5.5 Implement the Validator rule primitives
    - `server/src/validators/rules.js`: `str`, `int`, `bool`, `oneOf`, `url`, `email`, `isoDate`, `list`, `object` (unknown-key rejection at every nesting level), `refine`, password rule (1 character to 72 UTF-8 bytes, never trimmed), with code-point lengths after trimming and fixed reason tokens
    - _Requirements: 4.2, 5.4, 9.6, 10.3, 10.4, 13.7, 13.8, 15.3, 16.3, 16.4, 17.3, 18.2_

  - [ ]* 5.6 Write property test for the rule primitives
    - **Property 4: Primitive validation rules match their definitions**
    - **Validates: Requirements 5.4, 10.3, 10.4, 13.7, 13.8, 15.3, 16.3, 16.4, 17.3, 18.2**

  - [x] 5.7 Implement resource schemas, the validate middleware and identifier parsing
    - One schema module per resource: `loginBody`, `profileBody`, `settingsBody`, `publicProjectQuery`, `projectBody`, `publishBody`, `readBody`, `skillBody`, `experienceBody`, `educationBody` (injected clock for the current year), `contactBody` (unknown keys dropped), `contactListQuery`, `idParams`
    - `server/src/middleware/validate.js`: params first (400 `INVALID_ID`), then query and body (400 `VALIDATION_ERROR` with every `details` entry), normalized values stored in `req.valid`
    - `classifyIdentifier(raw)` returning `id`, `invalid`, `slug` or `none`
    - _Requirements: 4.2, 4.10, 4.12, 9.6, 11.3, 11.4, 11.7, 11.8, 12.3, 12.4, 12.10, 13.9, 13.13, 13.19, 14.6, 16.5, 16.6, 16.8, 17.4, 18.3, 19.10, 19.11_

  - [ ]* 5.8 Write property test for request schemas
    - **Property 5: Request validation verdict and details match the oracle**
    - **Validates: Requirements 4.2, 9.6, 11.3, 11.4, 11.7, 11.8, 12.10, 13.9, 13.19, 14.6, 16.5, 16.6, 16.8, 17.4, 18.3, 19.10, 19.11**

  - [ ]* 5.9 Write property test for id and identifier classification
    - **Property 3: Path ids and Project_Identifiers are classified correctly**
    - **Validates: Requirements 4.10, 12.3, 12.4, 12.5**

  - [ ]* 5.10 Write unit test that seed sample fixtures pass the Validator
    - Run every fixture in `server/seed/sampleContent.js` through its schema and check each sample Slug with `isSlug`
    - _Requirements: 3.5_

  - [x] 5.11 Implement the Slug_Generator
    - `server/src/utils/slug.js`: `isSlug`, `slugify`, `truncate`, `deriveSlug`, `generateUniqueSlug` as specified in the design
    - _Requirements: 13.10, 13.11, 13.12, 13.14_

  - [ ]* 5.12 Write property test for unique slug generation
    - **Property 1: Generated slugs are valid, unique and use the smallest suffix**
    - **Validates: Requirements 13.10, 13.11, 13.12, 13.14**

  - [ ]* 5.13 Write property test for slug idempotence
    - **Property 2: Slug derivation is idempotent on valid slugs**
    - **Validates: Requirements 13.14**

  - [x] 5.14 Implement contact sanitizing
    - `server/src/utils/sanitize.js`: `sanitizeText` removing U+0000–U+0008, U+000B, U+000C, U+000E–U+001F and U+007F, then trimming
    - _Requirements: 18.4_

  - [ ]* 5.15 Write property test for contact sanitizing
    - **Property 6: Contact sanitizing removes exactly the disallowed control characters**
    - **Validates: Requirements 18.4**

- [x] 6. Checkpoint - Backend core
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement authentication, authorization and rate limiting
  - [x] 7.1 Implement administrator login
    - `server/src/services/authService.js`: normalized email lookup, `hasher.compare` against the stored hash or a startup-generated cost-12 `DUMMY_HASH`, identical `InvalidCredentialsError` for unknown email and wrong password, JWT signed with HS256, `JWT_SECRET` and `expiresIn` in seconds with claims `{ sub, email, role }`
    - `auth.controller.js` and `auth.routes.js`: `POST /api/auth/login` with `loginBody`, no auth middleware, `Authorization` header ignored; response `{ token, admin: { id, email, role } }` without `password_hash`
    - Mount the auth router in `routes/index.js`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.10_

  - [ ]* 7.2 Write property test for login
    - **Property 10: Login succeeds only for the exact password and a normalized email match**
    - Inject a cost-4 hasher; add one example test that the production hasher uses cost 12
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [x] 7.3 Implement the Auth_Middleware, Role_Guard and `/auth/me`
    - `server/src/middleware/authenticate.js`: `Bearer` scheme parsing, `jwt.verify` with `algorithms: ['HS256']`, `sub` and `role` claim checks, admin existence query, `req.auth = { id, email, role }`
    - `server/src/middleware/requireRole.js` returning 403 `FORBIDDEN`
    - `GET /api/auth/me` returning `{ id, email, role }` from the database
    - _Requirements: 6.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8_

  - [ ]* 7.4 Write property test for authorization decisions
    - **Property 11: Auth_Middleware and Role_Guard decide correctly for any Authorization header**
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.7**

  - [x] 7.5 Implement the Rate_Limiter and apply it to login
    - `server/src/utils/rateLimiter.js`: `createFixedWindowLimiter({ windowMs, max, now })` with `check`, `record` and `sweep` on an `unref()`ed timer
    - `server/src/middleware/rateLimit.js`: key `req.ip`, 429 with `Retry-After`, record on `res.on('finish')` when `countWhen(res)` is true
    - Login limiter (15 min, 5 failures, counts status 401) on `POST /api/auth/login`; `app.set('trust proxy', 1)` only when `TRUST_PROXY=true`
    - _Requirements: 8.1, 8.3, 8.5, 8.6, 8.7, 9.3_

  - [ ]* 7.6 Write property test for the Rate_Limiter
    - **Property 8: Rate_Limiter matches the fixed-window model**
    - Use an injected fake clock
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.7**

  - [ ]* 7.7 Write integration tests for authentication
    - Login success, unknown email, wrong password, missing or invalid fields; protected endpoint 401 cases (no header, bad signature, malformed, expired, deleted admin) and the 403 role case
    - 6th failed login returns 429 with `Retry-After`; `TRUST_PROXY` on and off with a spoofed `X-Forwarded-For`
    - _Requirements: 5.1, 5.3, 5.4, 6.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.5, 8.6, 38.1, 38.2, 38.6_

- [x] 8. Checkpoint - Authentication
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement profile and settings APIs
  - [x] 9.1 Implement profile endpoints
    - `profileService` with `get()` and `update(fields)` using allow-listed columns and parameterized SQL; 404 when the row is missing, no row created
    - Controller and routes: `GET /api/profile` (public), `PUT /api/profile` (admin, `profileBody`); mount in `routes/index.js`
    - _Requirements: 9.1, 10.1, 10.2, 10.3, 10.4, 10.5, 10.10, 10.12_

  - [ ]* 9.2 Write property test for the profile round trip
    - **Property 15: Profile update round trip**
    - **Validates: Requirements 10.2, 10.5, 10.9**

  - [x] 9.3 Implement settings endpoints
    - `settingsService` with `getAll()` (stored values merged over defaults) and `update(partial)` (one transaction, `INSERT … ON CONFLICT DO UPDATE` per key)
    - Controller and routes: `GET /api/settings` (public), `PUT /api/settings` (admin, `settingsBody`); mount in `routes/index.js`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.7, 11.8_

  - [ ]* 9.4 Write property test for the settings round trip
    - **Property 16: Settings partial-update round trip**
    - **Validates: Requirements 11.2, 11.5**

- [x] 10. Implement project and technology APIs
  - [x] 10.1 Implement the technology service and endpoint
    - `technologyService.list()` ordered by `lower(name) COLLATE "C"`, then id; `ensureByNames(tx, names)` inserting unknown names with `ON CONFLICT ((lower(name))) DO NOTHING` and returning ids
    - `GET /api/technologies` (admin); mount in `routes/index.js`
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 10.2 Implement public project endpoints
    - `projectService.listPublic({ category })` using the single aggregated query; `getPublicById` and `getPublicBySlug` returning only Published_Projects
    - `GET /api/projects` (with `publicProjectQuery`) and `GET /api/projects/:identifier` (via `classifyIdentifier`; identical 404 body for unpublished and missing projects); mount in `routes/index.js`
    - _Requirements: 9.1, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.8, 12.9, 12.10, 35.10_

  - [x] 10.3 Implement admin project endpoints
    - `projectService.listAdmin`, `getAdmin`, `create`, `update`, `setPublished`, `remove`
    - Save transaction: advisory lock, existence check with `FOR UPDATE` before uniqueness, slug from input or `generateUniqueSlug`, 409 for a taken supplied slug, `is_published` false on create and kept on update when omitted, slug kept on update when omitted or empty, technologies via `ensureByNames`, replace `project_technologies`
    - Routes: `GET /api/admin/projects`, `GET /api/admin/projects/:id`, `POST /api/projects`, `PUT /api/projects/:id`, `PATCH /api/projects/:id/publish`, `DELETE /api/projects/:id`, all behind `authenticate` and `requireRole('admin')`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.13, 13.16, 13.17, 13.18, 13.19, 14.4, 14.5, 14.7, 35.10_

  - [ ]* 10.4 Write property test for the project round trip
    - **Property 18: Project create and update round trip**
    - **Validates: Requirements 13.3, 13.4, 13.15, 14.7**

  - [ ]* 10.5 Write property test for technology identity
    - **Property 19: Technology names have case-insensitive identity**
    - **Validates: Requirements 14.1, 14.2, 14.7, 13.6, 2.3**

  - [ ]* 10.6 Write property test for public project visibility
    - **Property 20: Public project visibility**
    - **Validates: Requirements 12.1, 12.2, 12.5, 12.7, 12.9**

  - [ ]* 10.7 Write property test for check precedence
    - **Property 14: The first failing check determines the response**
    - Use `createApp` with a fake project service layer
    - **Validates: Requirements 4.12, 4.5, 4.6**

  - [ ]* 10.8 Write integration tests for projects
    - Publication flow across public and admin endpoints by id and slug, with and without a token; duplicate slug → 409; unknown id → 404; bad id → 400; rollback when a technology write fails; same query count for 0, 1 and 200 projects
    - _Requirements: 13.17, 13.18, 14.5, 35.10, 38.3, 38.4, 38.7_

- [ ] 11. Implement skill, experience and education APIs
  - [x] 11.1 Implement skill endpoints
    - `skillService` with `list` (documented sort), `create`, `update` (omitted optional fields set to empty), `remove`
    - `GET /api/skills` (public), `POST`, `PUT /:id`, `DELETE /:id` (admin); mount in `routes/index.js`
    - _Requirements: 15.1, 15.2, 15.3, 15.7, 15.8_

  - [x] 11.2 Implement experience endpoints
    - `experienceService` with `list` (`start_date DESC, id DESC`), `create`, `update` (submitted fields replaced, omitted optional fields kept, whole responsibilities list replaced), `remove`
    - `GET /api/experiences` (public), `POST`, `PUT /:id`, `DELETE /:id` (admin); mount in `routes/index.js`
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.8, 16.9, 16.10_

  - [x] 11.3 Implement education endpoints
    - `educationService` with `list` (`start_year DESC, end_year DESC NULLS FIRST, id ASC`), `create`, `update` (all fields replaced), `remove`
    - `GET /api/education` (public), `POST`, `PUT /:id`, `DELETE /:id` (admin); mount in `routes/index.js`
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

  - [ ]* 11.4 Write property test for experience and education round trips
    - **Property 24: Experience and education round trip**
    - **Validates: Requirements 16.2, 16.7, 17.2, 17.7**

  - [ ]* 11.5 Write property test for list ordering
    - **Property 22: List endpoints return every row once in the documented order**
    - Cover skills, experiences, education, technologies and the admin project list
    - **Validates: Requirements 13.1, 14.3, 15.1, 15.6, 16.1, 17.1**

  - [ ]* 11.6 Write integration tests for skill, experience and education CRUD
    - Create 201, read, update 200, delete 200, read-after-delete absent; 400 with `details`; 404 for an unknown id; 400 for a bad id; end date before start date; end year out of range
    - _Requirements: 15.8, 16.5, 16.10, 17.4, 17.6, 38.3, 38.4_

- [x] 12. Implement contact and dashboard APIs
  - [x] 12.1 Implement contact submission
    - `contactService.submit(input)` with `INSERT … RETURNING id` and column defaults for `is_read` and `created_at`
    - `POST /api/contact` (public): plain-object check, honeypot `website` (any non-empty value → 201 `{ received: true }` with no write), pick and sanitize the four fields, validate, store; contact limiter (60 min, 5, counts status 201)
    - _Requirements: 8.2, 8.3, 8.4, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [ ]* 12.2 Write property test for contact submission
    - **Property 7: Contact submission outcome is all-or-nothing**
    - **Validates: Requirements 8.4, 18.1, 18.3, 18.5, 18.7**

  - [x] 12.3 Implement contact message management
    - `contactService.list({ page, limit, isRead })` with `LIMIT/OFFSET` and a filtered `count(*)`; `get(id)` with no side effects; `setRead(id, value)`; `remove(id)`
    - `GET /api/contact` (with `contactListQuery`, `meta { total, page, limit }`), `GET /api/contact/:id`, `PATCH /api/contact/:id/read`, `DELETE /api/contact/:id` (admin)
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.8, 19.10, 19.11_

  - [ ]* 12.4 Write property test for contact pagination
    - **Property 23: Contact pagination and filtering**
    - **Validates: Requirements 19.1, 19.2**

  - [ ]* 12.5 Write property test for flag updates
    - **Property 21: Flag updates change only the flag**
    - Cover `PATCH /api/projects/:id/publish`, `GET /api/contact/:id` and `PATCH /api/contact/:id/read`
    - **Validates: Requirements 13.5, 19.3, 19.4**

  - [x] 12.6 Implement dashboard statistics
    - `dashboardService.stats()`: one statement with seven `count(*)::int` subqueries
    - `GET /api/dashboard/stats` (admin); mount in `routes/index.js`
    - _Requirements: 20.1, 20.4, 20.5, 20.6_

  - [ ]* 12.7 Write property test for dashboard counts
    - **Property 27: Dashboard counts equal the database contents**
    - **Validates: Requirements 20.1, 20.4**

  - [ ]* 12.8 Write integration tests for contact
    - Valid submission stores one message and returns 201; invalid stores nothing and returns 400; honeypot returns 201 and stores nothing; 6th submission returns 429 with `Retry-After`; injected database failure returns a generic 500 with nothing stored; list, read by id, mark as read and delete
    - _Requirements: 18.6, 38.3, 38.5, 38.6_

- [x] 13. Verify cross-cutting API behavior
  - [x] 13.1 Finalize the API router and export its route table
    - Confirm `routes/index.js` mounts every router from the design's endpoint catalog with `notFound` last
    - Export a `listRoutes()` helper returning `{ method, path, auth }` entries, used by the authorization table tests and the README consistency check
    - _Requirements: 4.4, 7.1, 7.6_

  - [ ]* 13.2 Write property test for public endpoints and the Authorization header
    - **Property 12: Public endpoints ignore the Authorization header**
    - **Validates: Requirements 5.10, 7.9, 12.6**

  - [ ]* 13.3 Write property test for rejected writes
    - **Property 17: Rejected writes leave the database unchanged**
    - **Validates: Requirements 4.2, 10.10, 11.3, 11.7, 13.13, 14.6, 15.8, 16.8, 17.4, 18.3**

  - [ ]* 13.4 Write property test for deletes
    - **Property 25: Delete removes exactly the target**
    - **Validates: Requirements 13.6, 15.7, 16.9, 17.5, 19.8**

  - [ ]* 13.5 Write property test for timestamps
    - **Property 26: Updates advance updated_at and preserve created_at**
    - **Validates: Requirements 2.10**

  - [ ]* 13.6 Write cross-cutting integration tests
    - Table-driven: every endpoint in 7.1 without a token → 401; every endpoint in 7.6 never 401 or 403
    - Simulated database error → generic 500; `NODE_ENV=production` → no stack, SQL or internal message
    - Pool `max: 1` with the client held → 503 (reduced timeout in tests)
    - _Requirements: 7.1, 7.6, 7.8, 35.9, 38.8_

  - [ ]* 13.7 Write static checks for the server layers
    - No SQL keywords in `routes/` or `controllers/`; `server.js` contains no route handlers, SQL or validation rules
    - _Requirements: 1.4, 1.5, 1.6_

- [x] 14. Checkpoint - Backend APIs
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Build the Frontend foundation
  - [x] 15.1 Complete the API_Client and resource modules
    - `src/utils/tokenStorage.js` wrapping `sessionStorage` key `portfolio.admin.token`
    - Extend `src/api/apiClient.js`: `request(path, { method, body, auth, signal, skipUnauthorizedHandler })`, Bearer header when a token is stored, 15 s timeout via `AbortController` with caller signal forwarding, `ApiError`, `NETWORK_ERROR_MESSAGE`, `setUnauthorizedHandler` called with the used token on 401
    - Resource modules: `authApi`, `profileApi`, `settingsApi`, `projectsApi`, `technologiesApi`, `skillsApi`, `experiencesApi`, `educationApi`, `contactApi`, `dashboardApi`
    - _Requirements: 1.2, 32.1, 32.2, 32.3, 32.4, 32.5, 32.6, 36.2_

  - [ ]* 15.2 Write property test for API_Client response handling
    - **Property 35: API_Client normalizes every response**
    - **Validates: Requirements 32.4, 32.5, 32.6**

  - [x] 15.3 Implement the Auth_Context
    - `src/context/AuthContext.jsx`: states `checking`, `authenticated`, `unauthenticated`, `error`; one `GET /auth/me` at load when a token is stored; `login`, `logout` (no request), `retryVerification`, `sessionMessage`; unauthorized handler acting only when the used token equals the stored token
    - `resolvePostLoginPath(from)` helper
    - Wrap the app with `AuthProvider` in `main.jsx`
    - _Requirements: 6.2, 6.3, 6.4, 6.6, 6.7, 6.8, 30.3, 32.10_

  - [ ]* 15.4 Write property test for the post-login destination
    - **Property 34: Post-login destination is a safe admin path**
    - **Validates: Requirements 30.3**

  - [ ]* 15.5 Write property test for session expiry
    - **Property 38: Session expiry is handled exactly once**
    - Use `fc.scheduler()` for in-flight 401 ordering
    - **Validates: Requirements 6.4**

  - [x] 15.6 Implement shared hooks
    - `useFetch` (sequence numbers, abort on change and unmount, retry), `useAsyncAction`, `usePageTitle`, `useRouteFocus`, `useFocusTrap`, `useInView`
    - _Requirements: 21.6, 21.9, 31.6, 31.13, 32.7, 32.9, 32.11, 32.14, 32.15, 34.9, 34.10, 35.5_

  - [ ]* 15.7 Write property test for useFetch
    - **Property 37: useFetch shows only the latest result and never updates after unmount**
    - Use `fc.scheduler()` for out-of-order resolutions
    - **Validates: Requirements 32.11, 32.14, 32.15**

  - [x] 15.8 Implement client-side validation utilities
    - `src/utils/url.js` (`isValidUrl`, matching the server Valid_URL) and `src/utils/validation.js` mirroring the server rules for contact, login, project, skill, experience and education forms, plus `addTag(list, name)`
    - _Requirements: 9.7, 29.2, 30.2, 31.7, 31.8_

  - [ ]* 15.9 Write property test for client validation parity
    - **Property 36: Client-side validation mirrors the server rules**
    - Import the server schemas as the reference oracle
    - **Validates: Requirements 9.7, 29.2, 30.2, 31.7, 31.8**

  - [x] 15.10 Implement shared presentational components
    - `components/common/`: `LoadingIndicator`, `ErrorState` (message + Retry), `EmptyState`, `FormField` (label, `aria-describedby`, `aria-invalid`), `MultilineText` (`white-space: pre-line`), `SafeLink`, `LazyImage` (placeholder on invalid URL or load error)
    - Placeholder SVGs in `src/assets/`
    - _Requirements: 9.7, 22.2, 24.5, 25.7, 26.6, 32.7, 32.8, 32.9, 34.4, 34.5, 35.5, 35.6_

  - [x] 15.11 Implement the CSS foundation
    - `styles/tokens.css` (contrast-checked colors, spacing, type scale), `base.css`, `layout.css`, `components.css`, `admin.css`, imported once in `main.jsx`; page-level styles go in `styles/pages/<page>.css` imported by each page
    - Mobile-first breakpoints at 768 px and 1024 px; `img { max-width: 100%; height: auto }`; `overflow-wrap: anywhere`; `.table-scroll`; 44 px targets below 768 px; `:focus-visible` outline 3 px; reduced-motion rule; `.visually-hidden`; honeypot off-screen styles
    - _Requirements: 33.1, 33.2, 33.4, 33.5, 33.6, 33.7, 33.8, 34.1, 34.3, 34.8_

  - [x] 15.12 Implement SiteData and Notification contexts
    - `SiteDataContext` with shared `useFetch` calls for `GET /settings` and `GET /profile`
    - `NotificationContext` with `notify({ type, message })`, 5 s auto-dismiss for success, close button for errors, and `NotificationRegion` live regions (`polite` and `assertive`)
    - _Requirements: 21.9, 31.12, 34.11_

  - [x] 15.13 Implement routing, public layout and route guards
    - `App.jsx` routes with `lazy(() => import('./routes/AdminApp.jsx'))` inside `Suspense`; `PublicLayout` (SkipLink, `header` with `Navbar`, `main#main tabIndex=-1`, `Footer`, `useRouteFocus`); `Navbar` with active-link rules, menu toggle, Escape handling; `Footer` with settings and profile links; `NotFoundPage`
    - `routes/AdminApp.jsx` wrapped in `NotificationProvider`, `ProtectedRoute`, `GuestOnlyRoute`, every admin route from the design registered
    - Create minimal placeholder components for every public and admin page so all routes render; later tasks replace their bodies
    - _Requirements: 6.5, 11.6, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8, 21.9, 30.5, 30.6, 30.7, 34.6, 34.7, 35.2, 35.3_

  - [ ]* 15.14 Write component tests for the Frontend foundation
    - ProtectedRoute redirects an unauthenticated user to `/admin/login` and keeps the requested path; GuestOnlyRoute redirects to `/admin`; Auth_Context bootstrap cases (no token, 200, 401 on public and admin pages, network error with Retry); logout sends no request
    - Navbar order, active rules and `aria-current`; menu toggle `aria-expanded` and Escape focus return; footer omissions; document title with and without `site_title`; Notification live region and 5 s auto-dismiss with fake timers
    - _Requirements: 6.2, 6.3, 6.6, 6.7, 6.8, 21.1, 21.2, 21.3, 21.4, 21.6, 21.8, 21.9, 30.5, 30.6, 30.7, 31.12, 38.10_

- [x] 16. Checkpoint - Frontend foundation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Build the public pages
  - [x] 17.1 Implement formatting and list utilities
    - `src/utils/formatDate.js`: `formatMonthYear`, `formatDateRange`, `formatYearRange` reading only the date string
    - `src/utils/filters.js`: `deriveFilters`, `filterProjects`, `groupSkills`
    - _Requirements: 24.1, 25.5, 25.6, 27.3, 27.4, 28.2, 28.3_

  - [ ]* 17.2 Write property test for date formatting
    - **Property 30: Date and year ranges format correctly in every time zone**
    - **Validates: Requirements 27.3, 27.4, 28.2, 28.3**

  - [ ]* 17.3 Write property test for project filters
    - **Property 31: Project filter controls and filtering**
    - **Validates: Requirements 25.5, 25.6**

  - [ ]* 17.4 Write property test for skill grouping
    - **Property 32: Skill grouping keeps API order**
    - **Validates: Requirements 24.1**

  - [x] 17.5 Implement the Home page
    - Profile name as the only `h1`, professional title, full `hero_introduction` (omitted when empty), profile image via `LazyImage`, "View Projects" and "Contact Me" buttons, GitHub and LinkedIn `SafeLink`s, error with Retry while keeping both buttons
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7_

  - [x] 17.6 Implement the About page
    - Four Profile sections in order with headings, education background from `GET /api/education`, empty sections omitted, plain text with line breaks, empty-state message, per-source error with Retry
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6_

  - [x] 17.7 Implement the Skills page
    - Category headings in first-appearance order via `useMemo(groupSkills)`, proficiency text, decorative icons with placeholder, loading, empty and error states
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7, 32.13_

  - [x] 17.8 Implement the Projects page
    - One request, project cards (title, image with alt, short description, category, technologies, GitHub and Live Demo links, "View Details" to `/projects/<slug>`), filter controls via `useMemo`, responsive grid, empty and error states
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 25.7, 25.8, 25.9, 32.13, 33.3_

  - [x] 17.9 Implement the Project Details page
    - `useFetch(() => getProject(slug), [slug])`; all sections with empty ones omitted, features in order, technologies, new-tab links, image placeholder, loading, "Project not found" for 404, error with Retry for other failures, Projects link in every state, page title from the Project title
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6, 26.7, 26.8, 21.6, 32.15_

  - [x] 17.10 Implement the Experience page
    - Entries in API order with job title, company, Employment_Type, `formatDateRange`, description and responsibilities list; omissions for empty values; plain text; empty state only on success
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7, 27.8_

  - [x] 17.11 Implement the Education page
    - Entries in API order with institution, qualification, field of study, `formatYearRange`, description; omissions for empty values; plain text with line breaks; empty and error states
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7_

  - [x] 17.12 Implement the Contact page
    - Labeled fields, hidden `website` honeypot (`aria-hidden` wrapper, `tabIndex=-1`, `autoComplete="off"`), client validation with focus on the first invalid field, `useAsyncAction` submission with sending indicator, 201 success announcement and reset, 400 field errors, 429 message, network error, Profile email/GitHub/LinkedIn links with Retry on failure
    - _Requirements: 8.8, 29.1, 29.2, 29.3, 29.4, 29.5, 29.6, 29.7, 29.8, 29.9, 29.10, 29.11_

  - [ ]* 17.13 Write component tests for the public pages
    - Each page renders loaded, empty, loading and error states from a mocked API_Client; navigation between pages; contact form errors with no request for invalid input; 201, 400 and 429 contact flows; HTML-looking text renders literally
    - _Requirements: 23.4, 26.4, 26.8, 27.7, 29.3, 29.5, 29.6, 29.7, 38.10_

- [x] 18. Checkpoint - Public site
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Build the admin shell and shared admin components
  - [x] 19.1 Implement the login page
    - Labeled email and masked password fields, client validation, `useAsyncAction` with loading state, navigation via `resolvePostLoginPath`, 401/429 message with password cleared and email kept, 400 field errors, network/5xx Notification, session-expired message display
    - _Requirements: 6.4, 8.8, 30.1, 30.2, 30.3, 30.4, 30.8, 30.9, 30.10_

  - [x] 19.2 Implement the admin layout
    - `AdminLayout`, `Sidebar` (`nav aria-label="Admin"`, links with `aria-current`, toggle below 1024 px with `aria-expanded`, close on link selection), `Topbar` (admin email, Logout)
    - _Requirements: 6.3, 31.1, 31.2, 34.6_

  - [x] 19.3 Implement shared admin components
    - `DataTable` (`.table-scroll`, loading, empty and error with Retry), `ConfirmDialog` (`role="dialog"`, `aria-modal`, focus trap, Escape cancels, focus return), `ListEditor` (keyboard add, remove, move up and down), `TagInput` (suggestions, rejects empty and case-insensitive duplicates)
    - _Requirements: 31.3, 31.5, 31.6, 31.8, 31.9, 31.13, 31.14, 33.5, 34.10_

  - [x] 19.4 Implement the Overview page
    - Seven Dashboard_Stats cards with labels and values (including 0), links matching the sidebar destinations, error with Retry and no stale values
    - _Requirements: 20.2, 20.3, 20.7_

  - [ ]* 19.5 Write component tests for the admin shell
    - Login success, 401, 429, 400 and network flows; sidebar toggle; ConfirmDialog focus trap, Escape and focus return; Overview cards and error state
    - _Requirements: 20.2, 20.7, 30.4, 30.9, 30.10, 31.2, 31.5, 31.6_

- [x] 20. Build the content management pages
  - [x] 20.1 Implement project management pages
    - `ProjectsListPage` with publication label and toggle (status changes only after success), Edit and Delete with ConfirmDialog
    - `ProjectFormPage` for create and edit: all fields, `ListEditor` for features, `TagInput` for technologies with `GET /api/technologies` suggestions, client validation, slug-change warning with Continue and Cancel for Published_Projects, server field errors, success Notification and list reload
    - _Requirements: 13.1, 13.2, 31.3, 31.4, 31.5, 31.7, 31.8, 31.10, 31.11, 31.13, 31.15, 31.16_

  - [x] 20.2 Implement the skill reorder utility
    - `src/utils/reorder.js`: `computeSkillMove(skills, skillId, direction)` swapping values or renumbering 0..n−1 when values are equal
    - _Requirements: 15.5_

  - [ ]* 20.3 Write property test for skill moves
    - **Property 33: Skill move produces the requested order**
    - **Validates: Requirements 15.5**

  - [x] 20.4 Implement skill management pages
    - `SkillsListPage` with move up and down (disabled at category edges), `PUT` for each changed skill, reload after completion, error Notification and reload on failure
    - `SkillFormPage` with category suggestions (the five defaults plus existing categories), Proficiency_Level select, client validation
    - _Requirements: 15.4, 15.5, 15.9, 31.3, 31.7, 31.11, 31.15, 31.16_

  - [x] 20.5 Implement experience management pages
    - `ExperienceListPage` and `ExperienceFormPage` with Employment_Type select, dates, `ListEditor` for responsibilities, client validation including end date after start date
    - _Requirements: 16.3, 16.4, 16.6, 31.3, 31.7, 31.9, 31.11, 31.15, 31.16_

  - [x] 20.6 Implement education management pages
    - `EducationListPage` and `EducationFormPage` with year fields and client validation including the end-year range; edit pages load the list and show a not-found state for a missing id
    - _Requirements: 17.3, 17.4, 31.3, 31.7, 31.11, 31.15, 31.16_

  - [ ]* 20.7 Write component tests for content management
    - Invalid form sends no request; server 400 details shown next to fields with values kept; publish toggle changes only after success; slug warning Cancel sends no request; skill move failure shows an error and reloads; Delete Cancel sends no request
    - _Requirements: 15.9, 31.4, 31.5, 31.7, 31.10, 31.15, 31.16_

- [x] 21. Build messages, profile and settings pages
  - [x] 21.1 Implement message pages
    - `MessagesPage` with paging, read filter, unread text label and row styling, mark read and unread controls, View and Delete
    - `MessageDetailPage` showing sender, email, subject, full message and date; marks an unread message read on open and keeps it unread with a Notification on failure
    - _Requirements: 19.5, 19.6, 19.7, 19.9, 19.12, 31.3, 31.11, 31.16_

  - [x] 21.2 Implement the Profile form page
    - Load all ten fields before enabling submit, send all ten on submit with the button disabled, success Notification with returned values, error Notification with field errors and values kept
    - _Requirements: 10.6, 10.7, 10.8, 10.11_

  - [x] 21.3 Implement the Settings form page
    - Site title, hero introduction, footer text and a `social_links` editor (label + URL, up to 10), send changed values, success and error Notifications with values kept
    - _Requirements: 11.4, 11.9_

  - [ ]* 21.4 Write component tests for messages, profile and settings
    - Opening an unread message sends the PATCH and updates the list; PATCH failure keeps the unread label; Profile and Settings success and error flows
    - _Requirements: 10.7, 10.8, 11.9, 19.6, 19.12_

- [x] 22. Checkpoint - Admin dashboard
  - Ensure all tests pass, ask the user if questions arise.

- [x] 23. Add accessibility, responsive and performance checks
  - [x] 23.1 Add ESLint configuration for the Frontend
    - ESLint with React rules including `react/no-danger`, plus a `lint` script in `client/package.json`
    - _Requirements: 9.7, 32.12_

  - [x] 23.2 Implement the post-build check script
    - `client/scripts/check-build.js` run by a `build:check` script: no admin module in the entry chunk, gzipped JS loaded before first render ≤ 250 KB, no `JWT_SECRET`, `ADMIN_PASSWORD` or `localhost`/`127.0.0.1` strings unless the configured `VITE_API_BASE_URL` is a localhost URL
    - _Requirements: 6.5, 35.2, 35.3, 35.4, 36.2_

  - [ ]* 23.3 Write static source checks for the Frontend
    - No `fetch(` outside `src/api/apiClient.js`; `tokenStorage` imported only by `AuthContext` and `apiClient`; no class components; no database driver in `client/package.json`; no `JWT_SECRET` or `ADMIN_PASSWORD` in the source
    - _Requirements: 1.2, 1.3, 6.5, 32.1, 32.10, 32.12_

  - [ ]* 23.4 Write accessibility tests for every page
    - One `main` and one `h1` per page, no skipped heading levels, required landmarks with distinct `nav` names, Skip link first and moving focus to `main`, `aria-invalid`/`aria-describedby` on field errors, alt text rules, focus moves to `main` on route change
    - _Requirements: 34.2, 34.4, 34.5, 34.6, 34.7, 34.9_

  - [ ]* 23.5 Write lazy image tests
    - With a mocked IntersectionObserver, `LazyImage` sets no `src` until intersecting and shows the placeholder on error
    - _Requirements: 35.5, 35.6_

  - [ ]* 23.6 Write CSS rule checks
    - Parse the stylesheets to confirm breakpoints at 768 px and 1024 px, the project grid column counts, image max-width, `overflow-wrap`, `.table-scroll`, the 44 px target rule, the `:focus-visible` outline and the reduced-motion rule
    - _Requirements: 33.2, 33.3, 33.4, 33.5, 33.6, 33.7, 34.3, 34.8_

- [x] 24. Checkpoint - Quality checks
  - Ensure all tests pass, ask the user if questions arise.

- [x] 25. Write documentation and deployment configuration
  - [x] 25.1 Write the root README
    - Project description, stack per layer, directory structure, assumptions A1–A12 and risks R1–R6, prerequisites with minimum versions, numbered fresh-clone steps with directories, every environment variable (file, purpose, required, default, constraints), database creation, migration and seed commands, npm scripts, production deployment steps, the full endpoint table with auth and rate limits, placeholder values only
    - _Requirements: 37.1, 37.2, 37.3, 37.4, 37.5, 37.6, 37.7, 37.8, 37.9, 37.10, 37.11, 37.12_

  - [x] 25.2 Add static-host deployment configuration
    - SPA fallback to `index.html` and the recommended security headers and CSP as example host configuration files under `client/public/`, referenced from the README
    - _Requirements: 36.1, 37.8_

  - [ ]* 25.3 Write README consistency tests
    - The README environment table equals the union of the two `.env.example` files; the README endpoint table equals `listRoutes()`; no real secrets in the README
    - _Requirements: 37.5, 37.9, 37.10, 37.11_

- [x] 26. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Core implementation tasks are never optional.
- Each task references specific requirement criteria for traceability. Each property test names its design property and the criteria it validates.
- Server integration and property tests run against the PostgreSQL database in `TEST_DATABASE_URL`, reset before each test file (and inside each iteration for database-backed properties).
- The design's manual release checklist (layout at specific widths, keyboard walkthrough and contrast audit, the 1,000-request load test for 35.1, a hosted SSL database connection and a fresh-clone README walkthrough) is outside this plan because a coding agent cannot perform it. The indexes in 3.1 and the single-query project lists in 10.2 and 10.3 support 35.1.
- Accepted design decisions: JWT in `sessionStorage`, Experience PUT keeps omitted optional fields unchanged, and `DB_SSL_REJECT_UNAUTHORIZED` is kept.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5", "1.9"] },
    { "id": 3, "tasks": ["1.6", "1.10"] },
    { "id": 4, "tasks": ["1.7", "1.8", "3.1"] },
    { "id": 5, "tasks": ["3.2", "5.5", "5.11", "5.14"] },
    { "id": 6, "tasks": ["3.3", "5.1", "5.6", "5.12", "5.13", "5.15"] },
    { "id": 7, "tasks": ["3.4", "3.5", "5.2", "5.3"] },
    { "id": 8, "tasks": ["3.6", "3.7", "5.4", "5.7"] },
    { "id": 9, "tasks": ["5.8", "5.9", "5.10", "7.1"] },
    { "id": 10, "tasks": ["7.2", "7.3"] },
    { "id": 11, "tasks": ["7.4", "7.5"] },
    { "id": 12, "tasks": ["7.6", "7.7", "9.1"] },
    { "id": 13, "tasks": ["9.2", "9.3"] },
    { "id": 14, "tasks": ["9.4", "10.1"] },
    { "id": 15, "tasks": ["10.2"] },
    { "id": 16, "tasks": ["10.3"] },
    { "id": 17, "tasks": ["10.4", "10.5", "10.6", "10.7", "10.8", "11.1"] },
    { "id": 18, "tasks": ["11.2"] },
    { "id": 19, "tasks": ["11.3"] },
    { "id": 20, "tasks": ["11.4", "11.5", "11.6", "12.1"] },
    { "id": 21, "tasks": ["12.2", "12.3"] },
    { "id": 22, "tasks": ["12.4", "12.5", "12.6"] },
    { "id": 23, "tasks": ["12.7", "12.8", "13.1"] },
    { "id": 24, "tasks": ["13.2", "13.3", "13.4", "13.5", "13.6", "13.7", "15.1"] },
    { "id": 25, "tasks": ["15.2", "15.3", "15.6", "15.8"] },
    { "id": 26, "tasks": ["15.4", "15.5", "15.7", "15.9", "15.10", "15.11"] },
    { "id": 27, "tasks": ["15.12"] },
    { "id": 28, "tasks": ["15.13"] },
    { "id": 29, "tasks": ["15.14", "17.1"] },
    { "id": 30, "tasks": ["17.2", "17.3", "17.4", "17.5", "17.6", "17.7", "17.8", "17.9", "17.10", "17.11", "17.12"] },
    { "id": 31, "tasks": ["17.13", "19.1", "19.2", "19.3", "20.2"] },
    { "id": 32, "tasks": ["19.4", "20.1", "20.3", "20.4", "20.5", "20.6", "21.1", "21.2", "21.3"] },
    { "id": 33, "tasks": ["19.5", "20.7", "21.4", "23.1"] },
    { "id": 34, "tasks": ["23.2", "23.3", "23.4", "23.5", "23.6"] },
    { "id": 35, "tasks": ["25.1", "25.2"] },
    { "id": 36, "tasks": ["25.3"] }
  ]
}
```
