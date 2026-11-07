# Developer Portfolio CMS

## Project description

A full-stack developer portfolio with a built-in content management system.

- **Public_Site**: visitors (recruiters, hiring managers, collaborators) browse the developer's profile, skills, projects, experience and education, and send contact messages.
- **Admin_Dashboard**: a single administrator signs in at `/admin/login` and manages all portfolio content (profile, settings, projects, skills, experience, education and contact messages) without editing source code.

The repository is a monorepo with three layers: a React single-page app in `client/`, a REST API under `/api` in `server/`, and a PostgreSQL database that only the API server talks to.

## Technology stack

| Layer | Technologies |
|---|---|
| Frontend (`client/`) | React 19, Vite 8, React Router DOM 7, JavaScript (ES modules), plain CSS |
| API_Server (`server/`) | Node.js, Express 5, JavaScript (ES modules), custom rate limiter and security-header middleware, custom SQL migration runner and seed script |
| Database | PostgreSQL, accessed only by the API_Server through `pg` (node-postgres) |
| Authentication | bcrypt password hashing (`bcryptjs`, cost 12) and JSON Web Tokens (`jsonwebtoken`, HS256) with role-based authorization |
| Testing and tooling | Vitest, React Testing Library, Supertest, fast-check (property-based tests), ESLint 9 (flat config) |

## Directory structure

```
myPortfolio/
├── package.json        # Root orchestration scripts only (no dependencies)
├── README.md
├── client/             # Frontend (React + Vite)
│   ├── deploy/         # Static-host configuration examples for Vercel and nginx
│   ├── public/         # Files copied as-is into the build output (_redirects, _headers)
│   ├── scripts/        # Post-build checks (check-build.js) and the build-report Vite plugin
│   ├── src/            # Application source
│   │   ├── api/        # apiClient.js (the only module that calls fetch) and one module per resource
│   │   ├── assets/     # Placeholder SVG images
│   │   ├── components/ # Shared UI: common/, layout/, admin/ and projects/ components
│   │   ├── context/    # AuthContext, SiteDataContext and NotificationContext
│   │   ├── hooks/      # useFetch, useAsyncAction, usePageTitle, useFocusTrap, useInView and others
│   │   ├── pages/      # public/ pages of the Public_Site and admin/ pages of the Admin_Dashboard
│   │   ├── routes/     # AdminApp (lazy-loaded admin entry), ProtectedRoute and GuestOnlyRoute
│   │   ├── styles/     # Plain CSS: design tokens, base, layout, components, admin and page styles
│   │   └── utils/      # Pure helpers: validation, date formatting, URLs, token storage, filters
│   ├── index.html      # Vite HTML entry
│   ├── vite.config.js  # Build-time VITE_API_BASE_URL check and Vitest configuration
│   └── .env.example    # Frontend environment variables
└── server/             # API_Server (Node.js + Express)
    ├── migrations/     # Numbered SQL migration files (001_init_functions.sql ... 010_create_settings.sql)
    ├── scripts/        # CLI entry points: migrate.js and seed.js
    ├── seed/           # Sample content fixtures used when SEED_SAMPLE_CONTENT=true
    ├── src/            # Application source
    │   ├── config/     # env.js: validates every environment variable
    │   ├── controllers/# Request handlers: read validated input, call one service, send the response
    │   ├── db/         # Connection pool, queries, transactions, migration runner, startup check
    │   ├── middleware/ # Security headers, CORS, body size, authentication, role guard, rate limit, validation, errors
    │   ├── routes/     # One router per resource, plus routeTable.js listing every endpoint
    │   ├── services/   # Business logic; all SQL lives here and in db/
    │   ├── utils/      # Errors, slugs, durations, sanitizing, responses, logger, rate limiter
    │   └── validators/ # Validation rules and one request schema per resource
    ├── tests/          # unit/, integration/, property/ tests and helpers/
    ├── vitest.config.js# Vitest projects `unit` and `db`
    └── .env.example    # API_Server, Migration_Runner, Seed_Script and test variables
```

`client/dist/` (build output), `node_modules/` and every `.env` file are git-ignored. Only the `.env.example` files are committed.

## Assumptions and technical risks

These decisions resolve points the original product requirements left open.

### Assumptions

- **A1. Project slug vs id.** Public project URLs use the slug (for example `/projects/portfolio-management-system`). `GET /api/projects/:identifier` treats an all-digit value as a numeric id and anything else as a slug, so every slug must contain at least one letter.
- **A2. Public vs admin project access.** Public project endpoints return only published projects, even when the request carries a token. Administrators read all projects, including drafts, through `GET /api/admin/projects` and `GET /api/admin/projects/:id`. Writes use `POST/PUT/DELETE /api/projects[/:id]`, and `PATCH /api/projects/:id/publish` toggles publication.
- **A3. Responsibilities and features.** Experience records have an ordered `responsibilities` list and projects have an ordered `features` list of short text items.
- **A4. About page content.** The profile has `personal_introduction`, `career_interests` and `professional_goals` fields; `biography` is the short biography. The About page summarizes education records, so education data has one source.
- **A5. Social links.** The profile is the single source of the contact email, GitHub URL and LinkedIn URL. The `social_links` setting stores only additional links as an ordered list of label and URL pairs.
- **A6. Roles.** Admin accounts have a `role` column; v1 defines only `admin`. Tokens carry the role and the API checks it. There is no registration endpoint: the seed script creates the only admin account.
- **A7. Technologies vs skills.** Technologies are tags attached to projects; skills are the curated list on the Skills page. They are not linked. Assigning an unknown technology name to a project creates it (names match case-insensitively).
- **A8. Images.** Only http or https image URLs are supported; there are no file uploads. The Frontend shows a placeholder when an image URL is missing.
- **A9. Rate limiting.** Login allows 5 failed attempts per client IP address per 15-minute window. Contact submissions allow 5 per client IP address per 60-minute window. The contact form also has a hidden honeypot field (`website`). Counters live in API server memory (see R3).
- **A10. Token handling.** The JWT is sent as `Authorization: Bearer <token>` and expires after `JWT_EXPIRES_IN` (default 2 hours). The Frontend keeps it in `sessionStorage`, so closing the tab ends the session. Logout discards the token on the client; there is no server-side denylist.
- **A11. Singletons.** The profile is a single row. Settings is a key/value table limited to `site_title`, `hero_introduction`, `footer_text` and `social_links`.
- **A12. Opening a message.** Opening a contact message in the Admin_Dashboard marks it as read through `PATCH /api/contact/:id/read`. `GET /api/contact/:id` has no side effects.

### Technical risks

- **R1. Token storage in the browser.** A token in browser storage can be stolen through cross-site scripting (XSS). Mitigations: React's output escaping, no raw HTML rendering of user content, a short token lifetime and security headers.
- **R2. Slug changes break links.** Editing a slug changes the public URL. v1 accepts this, and the admin form warns before saving a changed slug on a published project.
- **R3. In-memory rate limiting.** Rate-limit counters reset when the API server restarts and are not shared between instances. Run exactly one API instance; scaling out would need a shared store.
- **R4. Hosted PostgreSQL SSL.** Hosted providers often require SSL. SSL is switched on with `DB_SSL=true`, with no code changes.
- **R5. Cross-origin deployment.** The Frontend and API_Server may run on different origins, so `FRONTEND_URL` must list the production Frontend origin exactly.
- **R6. Stateless logout.** A discarded token stays valid until it expires. The short default lifetime (2 hours) limits this exposure.

Other accepted design decisions: `PUT /api/experiences/:id` leaves omitted optional fields unchanged, and the seed script's sample projects are published.

## Prerequisites

| Software | Minimum version | Notes |
|---|---|---|
| Node.js | 22.12.0 | Set in the `engines` field of every `package.json`. Vite 8 also needs it. |
| npm | 10 | Ships with Node.js 22. |
| PostgreSQL | 14 | Tested with PostgreSQL 18. You need the `psql` client and a superuser (or a role allowed to create roles and databases). |
| Git | any recent version | To clone the repository. |

## Local installation (fresh clone)

Run each command from the directory shown. "Root" means the repository root (`myPortfolio/`). Commands work in PowerShell, bash and zsh unless a separate PowerShell form is given.

1. **Clone the repository** (from any parent directory):

   ```sh
   git clone <repository-url> myPortfolio
   cd myPortfolio
   ```

2. **Install the API_Server dependencies** (from root):

   ```sh
   npm --prefix server ci
   ```

3. **Install the Frontend dependencies** (from root):

   ```sh
   npm --prefix client ci
   ```

   The root `package.json` has no dependencies, so no install is needed at the root.

4. **Create the database role and the development and test databases** (from any directory; see [Database setup](#database-setup) for details). Replace `change-me` with your own password:

   ```sh
   psql -U postgres -h localhost -c "CREATE ROLE portfolio_user WITH LOGIN PASSWORD 'change-me';"
   psql -U postgres -h localhost -c "CREATE DATABASE portfolio_dev OWNER portfolio_user;"
   psql -U postgres -h localhost -c "CREATE DATABASE portfolio_test OWNER portfolio_user;"
   ```

5. **Create the environment files** (from root):

   ```sh
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```

   PowerShell:

   ```powershell
   Copy-Item server/.env.example server/.env
   Copy-Item client/.env.example client/.env
   ```

6. **Edit `server/.env`** (in an editor). At minimum set:
   - `DATABASE_URL` and `TEST_DATABASE_URL` with the password from step 4.
   - `JWT_SECRET` to a random value of at least 32 characters. Generate one with (from any directory):

     ```sh
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```

   - `ADMIN_EMAIL` and `ADMIN_PASSWORD` (12 or more characters) for the admin account the seed script creates.
   - Optionally `SEED_SAMPLE_CONTENT=true` to load sample projects, skills, experience and education.

   `client/.env` works unchanged when the API runs on the default port 5000. If you change `PORT`, change the port in `VITE_API_BASE_URL` too.

7. **Run the migrations** (from root):

   ```sh
   npm run migrate
   ```

8. **Run the seed script** (from root):

   ```sh
   npm run seed
   ```

9. **Start the API_Server in development mode** (from root, in its own terminal):

   ```sh
   npm run dev:server
   ```

10. **Start the Frontend dev server** (from root, in a second terminal):

    ```sh
    npm run dev:client
    ```

11. **Check the installation**. The health endpoint returns `{"success":true,"data":{"status":"ok"}}` with status 200 (from any directory; on Windows PowerShell use `curl.exe`):

    ```sh
    curl -i http://localhost:5000/api/health
    ```

    Then open `http://localhost:5173` for the Public_Site and `http://localhost:5173/admin/login` to sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## Environment variables

Each variable belongs to exactly one example file. Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env`, then replace the placeholders. Never commit a `.env` file.

- The API_Server, Migration_Runner, Seed_Script and server tests load `server/.env` when it exists. Variables already set in the process environment take precedence.
- Vite reads `client/.env` at dev-server start and at build time. A `VITE_API_BASE_URL` set in the process environment wins over the file.
- An unset or empty variable gets its default. Boolean variables accept only `true` or `false` (case-insensitive); any other value is a configuration error.
- An invalid configuration stops the process with exit code 1 and a message that names each invalid variable without printing its value.

| Variable | File | Required | Default | Purpose and constraints |
|---|---|---|---|---|
| `PORT` | `server/.env.example` | Optional | `5000` | Port the API_Server listens on. Integer 1–65535. |
| `NODE_ENV` | `server/.env.example` | Optional | `development` | `production` hides stack traces, SQL and internal error messages from error responses. `npm start` sets it to `production`. |
| `DATABASE_URL` | `server/.env.example` | Required unless `PGHOST`, `PGUSER` and `PGDATABASE` are set | – | `postgres://` or `postgresql://` connection URL. Takes precedence over `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE`: when it is set, those five are ignored. Do not put `sslmode` in it; use `DB_SSL`. Never logged. |
| `PGHOST` | `server/.env.example` | Required when `DATABASE_URL` is unset | – | Database host. Ignored when `DATABASE_URL` is set. |
| `PGPORT` | `server/.env.example` | Optional | `5432` | Database port, integer 1–65535. Ignored when `DATABASE_URL` is set. |
| `PGUSER` | `server/.env.example` | Required when `DATABASE_URL` is unset | – | Database user. Ignored when `DATABASE_URL` is set. |
| `PGPASSWORD` | `server/.env.example` | Optional | – | Database password. Not trimmed. Never logged. Ignored when `DATABASE_URL` is set. |
| `PGDATABASE` | `server/.env.example` | Required when `DATABASE_URL` is unset | – | Database name. Ignored when `DATABASE_URL` is set. |
| `DB_SSL` | `server/.env.example` | Optional | `false` | `true` opens every Database connection over SSL, with no fallback to an unencrypted connection. Set `true` for hosted providers that require SSL. |
| `DB_SSL_REJECT_UNAUTHORIZED` | `server/.env.example` | Optional | `true` | Verify the server certificate when `DB_SSL=true`. Set `false` only for providers with self-signed certificate chains. |
| `DB_POOL_MAX` | `server/.env.example` | Optional | `10` | Maximum connections in the pool. Integer 1–100. |
| `JWT_SECRET` | `server/.env.example` | Required | – | HS256 signing secret for admin tokens. At least 32 characters; use a long random value. |
| `JWT_EXPIRES_IN` | `server/.env.example` | Optional | `2h` | Token lifetime: a positive whole number of seconds, or a whole number followed by `s`, `m`, `h` or `d` (for example `900`, `30m`, `2h`). |
| `FRONTEND_URL` | `server/.env.example` | Required | – | Comma-separated list of exact Frontend origins allowed by CORS (for example `http://localhost:5173`). Each entry must be an http or https origin; a trailing `/` is ignored. |
| `TRUST_PROXY` | `server/.env.example` | Optional | `false` | `true` when the API_Server runs behind exactly one reverse proxy, so the rate limiter uses the client IP from `X-Forwarded-For`. Leave `false` otherwise, or clients can spoof their IP. |
| `ADMIN_EMAIL` | `server/.env.example` | Required by the Seed_Script | – | Email of the initial admin account. Must be a valid email of at most 254 characters; stored lowercased. Used as the login email. |
| `ADMIN_PASSWORD` | `server/.env.example` | Required by the Seed_Script | – | Password of the initial admin account. At least 12 characters and at most 72 bytes (UTF-8), the bcrypt limit. Not trimmed. Never logged. Remove it from the host environment after seeding. |
| `SEED_SAMPLE_CONTENT` | `server/.env.example` | Optional | `false` | `true` makes the Seed_Script insert sample projects (published), skills, experience and education when those four tables are all empty. |
| `TEST_DATABASE_URL` | `server/.env.example` | Required by the server tests | – | URL of a dedicated test database. Must differ from `DATABASE_URL`; the test setup refuses to run otherwise. The `db` tests migrate it and truncate its tables. |
| `VITE_API_BASE_URL` | `client/.env.example` | Required | – | API base URL including `/api` (for example `http://localhost:5000/api`). Every Frontend request uses it. The production build (`npm run build`) stops with an error naming this variable when it is unset or empty. The value is embedded in the built files, so it must not contain secrets. |

## Database setup

The examples use the placeholder role `portfolio_user` with password `change-me` and the databases `portfolio_dev` (development) and `portfolio_test` (tests). Use your own names and password.

1. **Create the role and databases** with `psql` as a PostgreSQL superuser (from any directory):

   ```sh
   psql -U postgres -h localhost -c "CREATE ROLE portfolio_user WITH LOGIN PASSWORD 'change-me';"
   psql -U postgres -h localhost -c "CREATE DATABASE portfolio_dev OWNER portfolio_user;"
   psql -U postgres -h localhost -c "CREATE DATABASE portfolio_test OWNER portfolio_user;"
   ```

   Making `portfolio_user` the owner lets it create tables in the `public` schema, including on PostgreSQL 15 and later. The migrations need no extensions or superuser rights.

2. **Point the API at the databases** in `server/.env`:

   ```dotenv
   DATABASE_URL=postgres://portfolio_user:change-me@localhost:5432/portfolio_dev
   TEST_DATABASE_URL=postgres://portfolio_user:change-me@localhost:5432/portfolio_test
   ```

   Percent-encode special characters in the password (for example `@` as `%40`). Instead of `DATABASE_URL` you can set `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE`; `DATABASE_URL` wins when both forms are set.

3. **Run the migrations** (from root `npm run migrate`, or from `server/` `npm run migrate`). The Migration_Runner applies every pending file in `server/migrations/` in numeric order, each in its own transaction, and records it in the `schema_migrations` table. Re-running it prints "No pending migrations" and exits 0. A failing migration is rolled back, stops the run and exits 1.

4. **Run the seed script** (from root `npm run seed`, or from `server/` `npm run seed`). It needs `ADMIN_EMAIL` and `ADMIN_PASSWORD` and validates them before connecting. In one transaction it:
   - creates the admin account (bcrypt hash, role `admin`) only when no admin exists;
   - creates the profile row (placeholder name and title, `ADMIN_EMAIL` as contact email) when it is missing;
   - creates the four settings keys with default values when they are missing;
   - inserts sample content when `SEED_SAMPLE_CONTENT=true` and the projects, skills, experiences and education tables are all empty.

   The seed script is safe to re-run. When an admin account already exists it reports "Admin account already exists" and leaves that account unchanged, so changing `ADMIN_PASSWORD` later does not change the stored password. Existing profile, settings and content are also left unchanged. To load sample content, set `SEED_SAMPLE_CONTENT=true` in `server/.env` and run `npm run seed` again on a database with no projects, skills, experiences or education.

The test database needs no manual migration: the `db` test project migrates `TEST_DATABASE_URL` before the tests start.

## npm scripts

Run each script from the directory in the "Directory" column with `npm run <script>` (`npm test` and `npm start` also work without `run`). The root scripts delegate to `server/` and `client/` with `npm --prefix`.

| Directory | Script | Exact command | Purpose |
|---|---|---|---|
| root | `dev:client` | `npm --prefix client run dev` | Start the Frontend dev server. |
| root | `dev:server` | `npm --prefix server run dev` | Start the API_Server in development mode. |
| root | `build` | `npm --prefix client run build` | Build the Frontend for production. |
| root | `migrate` | `npm --prefix server run migrate` | Run the Migration_Runner. |
| root | `seed` | `npm --prefix server run seed` | Run the Seed_Script. |
| root | `test` | `npm --prefix server test && npm --prefix client test` | Run every API_Server test (unit and database), then every Frontend test, once. |
| root | `test:unit` | `npm --prefix server run test:unit && npm --prefix client test` | Run the API_Server unit tests and the Frontend tests, which need no database. |
| `server/` | `dev` | `node --watch src/server.js` | Start the API_Server and restart it on file changes. |
| `server/` | `start` | `cross-env NODE_ENV=production node src/server.js` | Start the API_Server in production mode. |
| `server/` | `migrate` | `node scripts/migrate.js` | Apply pending SQL migrations. |
| `server/` | `seed` | `node scripts/seed.js` | Create the admin account, default profile and settings, and optional sample content. |
| `server/` | `test` | `vitest run` | Run the `unit` and `db` Vitest projects once. |
| `server/` | `test:unit` | `vitest run --project unit` | Run only `tests/unit` (no database connection). |
| `server/` | `test:db` | `vitest run --project db` | Run only `tests/integration` and `tests/property` against `TEST_DATABASE_URL`. |
| `client/` | `dev` | `vite` | Start the Vite dev server at `http://localhost:5173`. |
| `client/` | `build` | `vite build` | Build static production files into `client/dist/`. Fails when `VITE_API_BASE_URL` is unset or empty. |
| `client/` | `build:check` | `vite build && node scripts/check-build.js` | Build, then check that admin code is lazy-loaded, the initial JavaScript is at most 250 KB gzipped, and no secret names or unexpected `localhost` URLs are in `dist/`. |
| `client/` | `test` | `vitest run` | Run every Frontend test once (jsdom, mocked API; no server or database needed). |
| `client/` | `lint` | `eslint .` | Lint the Frontend source. |

### Running the tests

- Every test script is a single run: it exits 0 when all tests pass and non-zero otherwise.
- The server tests are split into two Vitest projects. `unit` (`tests/unit`) never connects to a database. `db` (`tests/integration`, `tests/property`) runs against `TEST_DATABASE_URL`; its global setup migrates that database once, and each test file truncates the tables first. Test files run one at a time.
- The server test setup checks `TEST_DATABASE_URL` before any server test runs, including `test:unit`. It must be set and must differ from `DATABASE_URL`. For unit tests alone the database does not need to exist.
- Property-based tests (fast-check) run at least 100 generated inputs each and print the failing input when they fail.

## API endpoints

All endpoints are under `/api`. "Administrator JWT required" means the request needs an `Authorization: Bearer <token>` header with a valid, unexpired token from `POST /api/auth/login` for an existing account with role `admin` (401 otherwise, 403 for another role). Success responses have the shape `{ "success": true, "data": ..., "meta"?: ... }`; error responses have `{ "success": false, "error": { "code", "message", "details"? } }`.

| Method | Path | Authentication | Rate limit | Purpose |
|---|---|---|---|---|
| GET | `/api/health` | public | – | Reports whether the API and its database answer (200, or 503 when the database fails or takes over 5 seconds). |
| POST | `/api/auth/login` | public | 5 failed attempts per client IP per 15 minutes; the 6th returns 429 with `Retry-After` | Exchanges an email and password for a JWT and the admin's id, email and role. |
| GET | `/api/auth/me` | Administrator JWT required | – | Returns the signed-in admin's id, email and role. |
| GET | `/api/profile` | public | – | Returns the single profile record (404 until the seed script has run). |
| PUT | `/api/profile` | Administrator JWT required | – | Updates the profile; omitted fields stay unchanged. |
| GET | `/api/settings` | public | – | Returns the website settings (site title, hero introduction, footer text, social links). |
| PUT | `/api/settings` | Administrator JWT required | – | Updates one or more settings keys; omitted keys stay unchanged. |
| GET | `/api/projects` | public | – | Lists published projects, optionally filtered by `?category=`. |
| GET | `/api/projects/:identifier` | public | – | Returns one published project by numeric id or slug. |
| GET | `/api/admin/projects` | Administrator JWT required | – | Lists all projects, including unpublished ones. |
| GET | `/api/admin/projects/:id` | Administrator JWT required | – | Returns any project by id, including an unpublished one. |
| POST | `/api/projects` | Administrator JWT required | – | Creates a project (slug generated from the title when omitted). |
| PUT | `/api/projects/:id` | Administrator JWT required | – | Replaces a project's fields and technology tags; an omitted slug or publish flag is kept. |
| PATCH | `/api/projects/:id/publish` | Administrator JWT required | – | Publishes or unpublishes a project. |
| DELETE | `/api/projects/:id` | Administrator JWT required | – | Deletes a project. |
| GET | `/api/technologies` | Administrator JWT required | – | Lists all technology tags for the project form. |
| GET | `/api/skills` | public | – | Lists all skills in display order. |
| POST | `/api/skills` | Administrator JWT required | – | Creates a skill. |
| PUT | `/api/skills/:id` | Administrator JWT required | – | Updates a skill. |
| DELETE | `/api/skills/:id` | Administrator JWT required | – | Deletes a skill. |
| GET | `/api/experiences` | public | – | Lists all experience records. |
| POST | `/api/experiences` | Administrator JWT required | – | Creates an experience record. |
| PUT | `/api/experiences/:id` | Administrator JWT required | – | Updates an experience record; omitted optional fields stay unchanged. |
| DELETE | `/api/experiences/:id` | Administrator JWT required | – | Deletes an experience record. |
| GET | `/api/education` | public | – | Lists all education records. |
| POST | `/api/education` | Administrator JWT required | – | Creates an education record. |
| PUT | `/api/education/:id` | Administrator JWT required | – | Updates an education record. |
| DELETE | `/api/education/:id` | Administrator JWT required | – | Deletes an education record. |
| POST | `/api/contact` | public | 5 submissions per client IP per 60 minutes; the 6th returns 429 with `Retry-After` | Stores a contact message (a filled honeypot field `website` is accepted but not stored). |
| GET | `/api/contact` | Administrator JWT required | – | Lists contact messages with pagination (`?page`, `?limit`) and an optional `?is_read` filter. |
| GET | `/api/contact/:id` | Administrator JWT required | – | Returns one contact message without changing it. |
| PATCH | `/api/contact/:id/read` | Administrator JWT required | – | Marks a contact message as read or unread. |
| DELETE | `/api/contact/:id` | Administrator JWT required | – | Deletes a contact message. |
| GET | `/api/dashboard/stats` | Administrator JWT required | – | Returns the content and message counts shown on the dashboard overview. |

Any other path under `/api` returns 404 `ROUTE_NOT_FOUND`. Request bodies over 100 KB return 413. The authoritative list is `server/src/routes/routeTable.js` (`listRoutes()`), which a unit test keeps in sync with the mounted routers.

## Production deployment

The Frontend is a set of static files for any static host. The API_Server is one long-running Node.js process. The database is a hosted PostgreSQL instance. The example origins below (`https://www.example.com`, `https://api.example.com`) are placeholders.

### 1. Database (hosted PostgreSQL)

1. Create a PostgreSQL 14+ database with your provider and note its connection URL, for example `postgres://portfolio_user:<password>@db.example.com:5432/portfolio`.
2. Check whether the provider requires SSL. Most do: then set `DB_SSL=true` on the API host. Set `DB_SSL_REJECT_UNAUTHORIZED=false` only if the provider documents a self-signed certificate chain.

### 2. API_Server

1. Deploy the `server/` directory and install production dependencies (from `server/`):

   ```sh
   npm ci --omit=dev
   ```

2. Set these environment variables in the host's settings (not in a committed file):

   ```dotenv
   NODE_ENV=production
   PORT=<port required by the host, default 5000>
   DATABASE_URL=postgres://portfolio_user:<password>@db.example.com:5432/portfolio
   DB_SSL=true
   JWT_SECRET=<generate-a-64+-char-random-hex>
   JWT_EXPIRES_IN=2h
   FRONTEND_URL=https://www.example.com
   TRUST_PROXY=true
   ```

   - `FRONTEND_URL` must be the exact production Frontend origin: scheme, host and port, no path (R5). List several origins separated by commas if needed.
   - Set `TRUST_PROXY=true` only when exactly one reverse proxy or load balancer sits in front of the API (true on most platforms). Without a proxy, keep `false`.

3. Run the migrations against the hosted database (from `server/`, with the variables above set):

   ```sh
   npm run migrate
   ```

4. Run the seed script once with the admin credentials (from `server/`), using `ADMIN_EMAIL=admin@example.com`-style values of your own and an `ADMIN_PASSWORD` of 12 or more characters:

   ```sh
   npm run seed
   ```

   Then remove `ADMIN_PASSWORD` (and `ADMIN_EMAIL` if you like) from the host environment. Re-running the seed later never changes the existing admin account.

5. Start the API (from `server/`):

   ```sh
   npm start
   ```

   Run **exactly one instance**. The rate-limit counters are held in memory (R3), so several instances or a cluster would each count separately. Disable autoscaling beyond one instance.

### 3. Frontend

1. Set `VITE_API_BASE_URL` to the production API URL including `/api` in the build environment, for example in the static host's build settings:

   ```dotenv
   VITE_API_BASE_URL=https://api.example.com/api
   ```

   To build locally instead, set it in the shell first (bash: `export VITE_API_BASE_URL=https://api.example.com/api`; PowerShell: `$env:VITE_API_BASE_URL = "https://api.example.com/api"`). A value set in the environment overrides `client/.env`.

2. Install and build (from `client/`):

   ```sh
   npm ci
   npm run build:check
   ```

   `npm run build` produces the files; `build:check` also runs the post-build checks. The build stops with an error naming `VITE_API_BASE_URL` when it is unset or empty.

3. Publish `client/dist/` to the static host. Configure the host as described in [Static host configuration](#static-host-configuration).

### Static host configuration

The Frontend uses client-side routing, so the host must serve `index.html` for every unknown path (SPA fallback). Otherwise a reload of `/projects/<slug>` or `/admin` returns the host's 404 page. The host should also send security headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` and a Content-Security-Policy whose `connect-src` allows the API origin and whose `img-src` allows `https:` images.

Example configuration files with the same rules and header values:

| File | Host | How it is used |
|---|---|---|
| `client/public/_redirects` | Netlify | SPA fallback rule `/* /index.html 200`. Vite copies `client/public/` into `client/dist/`, so it is published with the build. |
| `client/public/_headers` | Netlify, Cloudflare Pages | Security headers and CSP, also copied into `client/dist/`. Comments in the file explain each CSP directive. |
| `client/deploy/vercel.json` | Vercel | Copy it to the Vercel project's root directory (`client/vercel.json` when the root directory is `client`). |
| `client/deploy/nginx.conf` | nginx | Example `server` block with the fallback and headers. |

`client/deploy/README.md` describes these files in more detail. Before deploying, replace the placeholder `https://api.example.com` in the CSP `connect-src` directive with your API origin: the scheme, host and port of `VITE_API_BASE_URL` without the `/api` path. With the placeholder left in, the browser blocks every API request. For other hosts, configure the same fallback rule and headers in the host's own settings.

### 4. Verify the deployment

1. Request the health endpoint (from any machine):

   ```sh
   curl -i https://api.example.com/api/health
   ```

   It must return status 200 with `{"success":true,"data":{"status":"ok"}}`. A 503 means the API cannot reach the database; check `DATABASE_URL` and `DB_SSL`.

2. Open `https://www.example.com/admin/login` and sign in with the seeded admin email and password.

## Troubleshooting

- **`npm run seed` fails with `ADMIN_PASSWORD (must be at least 12 characters)`.** The admin password needs at least 12 characters (and at most 72 bytes). Fix it in `server/.env` and run the seed again; nothing was written.
- **`GET /api/profile` returns 404.** The profile row does not exist until the seed script runs, so pages that show profile data have nothing to load. Run `npm run seed`.
- **The API server exits at startup with `Invalid configuration: ...`.** The message names each missing or invalid variable. Check those variables against the [Environment variables](#environment-variables) table.
- **Port 5000 is already in use.** On Windows, port 5000 can fall in a range reserved by the system (see `netsh interface ipv4 show excludedportrange protocol=tcp`), and on macOS the AirPlay Receiver uses it. Set another port, for example `PORT=5050` in `server/.env` and `VITE_API_BASE_URL=http://localhost:5050/api` in `client/.env`, then restart both dev servers (Vite reads `.env` only at startup).
- **The browser reports a CORS error.** `FRONTEND_URL` must match the page's origin exactly. `http://localhost:5173` and `http://127.0.0.1:5173` are different origins.
- **Login returns 429.** Five failed logins from one IP within 15 minutes block further attempts until the window ends (see the `Retry-After` header). Restarting the API also clears the counters.
- **Server tests refuse to run.** `TEST_DATABASE_URL` is unset or equal to `DATABASE_URL`. Point it at a separate database such as `portfolio_test`. If the `db` tests cannot connect, create that database or run `npm run test:unit`.
- **The production build fails with a `VITE_API_BASE_URL` error.** Set the variable in the build environment or in `client/.env`.
