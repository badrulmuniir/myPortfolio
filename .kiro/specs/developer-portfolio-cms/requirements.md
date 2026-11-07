# Requirements Document

## Introduction

This document specifies a full-stack developer portfolio website with an administrator content management system (CMS). Public visitors (recruiters, hiring managers, internship coordinators, developers, collaborators) browse the developer's profile, skills, projects, experience and education, and submit contact messages. A single administrator signs in to a protected dashboard and manages all portfolio content without editing source code.

The system uses a three-layer architecture inside one monorepo rooted at `c:\PROJECT\myPortfolio`:

- Presentation layer: React + Vite + JavaScript + React Router DOM + plain CSS, in `client/`.
- Application layer: Node.js + Express REST API under the `/api` base path, in `server/`.
- Data layer: PostgreSQL accessed only by the API server through `pg` (node-postgres).

Authentication uses bcrypt password hashing and JSON Web Tokens (JWT), with role-based authorization enforced by the API server.

### Assumptions and Resolved Ambiguities

The PRD left the following points open. Each one is resolved here and reflected in the requirements below. The user should confirm or change these during review.

- **A1. Project slug vs id.** Public project URLs use the slug (`/projects/portfolio-management-system`). The public endpoint `GET /api/projects/:identifier` accepts either a numeric id or a slug: a value made only of digits is treated as an id, anything else as a slug. To keep the two unambiguous, every slug must contain at least one letter.
- **A2. Public vs admin project access.** Public endpoints (`GET /api/projects`, `GET /api/projects/:identifier`) return only published projects, whether or not the request carries a token. This keeps an administrator's browser from accidentally showing drafts on the public site. Administrators read all projects, including unpublished ones, through separate protected endpoints `GET /api/admin/projects` and `GET /api/admin/projects/:id`. The write endpoints keep the PRD paths (`POST /api/projects`, `PUT /api/projects/:id`, `DELETE /api/projects/:id`), plus `PATCH /api/projects/:id/publish` to toggle publication.
- **A3. Responsibilities and features.** The `experiences` table gains a `responsibilities` field and the `projects` table gains a `features` field. Each field holds an ordered list of short text items. The design phase chooses the storage type (for example a PostgreSQL text array or JSONB).
- **A4. About page content.** The `profile` table gains `personal_introduction`, `career_interests` and `professional_goals` text fields. `biography` remains the short biography. The About page shows educational background by summarizing the Education_Records, so education data has a single source.
- **A5. Social links.** Profile is the single source for the contact email, GitHub URL and LinkedIn URL used on the Home, Contact and footer areas. The Settings "social media links" entry stores only additional links (for example X/Twitter, a blog or Stack Overflow) as an ordered list of label + URL pairs.
- **A6. Roles.** The `admins` table gains a `role` column. v1 defines one role, `admin`. Tokens carry the role, and authorization middleware checks it, so new roles can be added later without changing every route. v1 has no registration endpoint; the only administrator account is created by the seed script.
- **A7. Technologies vs Skills.** These are independent. Technologies are tags attached to projects through `project_technologies` and shown on project cards and detail pages. Skills are the curated list on the Skills page. v1 does not link them. The administrator assigns technologies to a project by name, and an unknown name creates a new Technology (matched case-insensitively).
- **A8. Images.** v1 supports image URLs only (http or https). File uploads are out of scope. When an image URL is missing, the Frontend shows a placeholder.
- **A9. Rate limiting.** Login is limited to 5 failed attempts per client IP address in a 15-minute window. Contact submissions are limited to 5 per client IP address per 60-minute window. The contact form also includes a hidden honeypot field. Counters are held in API server memory, which suits the single-instance deployment assumed for v1 (see R3).
- **A10. Token handling.** The JWT is sent in the `Authorization: Bearer <token>` header. Tokens expire after a configurable period (default 2 hours, set by `JWT_EXPIRES_IN`). Logout discards the token on the client. v1 does not keep a server-side token denylist.
- **A11. Singletons.** Profile is a single row. Settings is a key/value table limited to a fixed set of allowed keys.
- **A12. Opening a message.** When the administrator opens a Contact_Message's details in the Admin_Dashboard, the Frontend marks it as read. `GET /api/contact/:id` itself has no side effects.

### Technical Risks

- **R1. Token storage in the browser.** A token kept in browser storage can be stolen through cross-site scripting (XSS). Mitigations: React's default output escaping, no raw HTML rendering of user-supplied content, short token lifetime, and security headers.
- **R2. Slug changes break links.** Editing a slug changes the public URL. v1 accepts this. The admin form warns before saving a changed slug on a published project.
- **R3. In-memory rate limiting.** Counters reset on server restart and are not shared between instances. This is acceptable for one instance; scaling out would need a shared store.
- **R4. Hosted PostgreSQL SSL.** Hosted providers often require SSL connections. SSL is controlled by configuration rather than code changes.
- **R5. Cross-origin deployment.** The Frontend and API_Server may be hosted on different origins, so CORS must list the production Frontend origin exactly.
- **R6. Stateless logout.** A discarded token stays valid until it expires. The short default lifetime limits this exposure.

## Glossary

- **Portfolio_System**: The complete application: Frontend, API_Server and Database.
- **Frontend**: The React single-page application in `client/` that renders the Public_Site and the Admin_Dashboard.
- **Public_Site**: The Frontend pages that require no authentication: Home, About, Skills, Projects, Project Details, Experience, Education and Contact.
- **Admin_Dashboard**: The Frontend pages under the `/admin` path, available only to an authenticated Administrator.
- **API_Server**: The Node.js + Express application in `server/` that serves the REST API under `/api`.
- **Database**: The PostgreSQL database that stores all persistent data.
- **Visitor**: An unauthenticated person using the Public_Site.
- **Administrator**: The portfolio owner, holding an admin account with the `admin` role.
- **Auth_Middleware**: The API_Server component that verifies the JWT on a request and attaches the authenticated Administrator's identity and role.
- **Role_Guard**: The API_Server component that allows or rejects a request based on the role in the verified JWT.
- **JWT**: A signed JSON Web Token issued by the API_Server at login. It contains the admin id, email and role, and has an expiry time.
- **Protected_Route**: A Frontend route that renders only for an authenticated Administrator.
- **Auth_Context**: The React context holding the current authentication state (token, admin identity, loading status) for the Frontend.
- **API_Client**: The Frontend module that performs all HTTP communication with the API_Server. UI components do not call fetch directly.
- **Validator**: The API_Server component that checks request parameters and bodies against defined rules before business logic runs.
- **Error_Handler**: The centralized API_Server middleware that turns errors into Error_Responses.
- **Rate_Limiter**: The API_Server component that counts requests per client IP address in a time window and rejects requests over the limit.
- **Success_Response**: A JSON body of the form `{ "success": true, "data": <payload> }`, with an optional `meta` object for pagination.
- **Error_Response**: A JSON body of the form `{ "success": false, "error": { "code": <string>, "message": <string>, "details": <optional array of field errors> } }`.
- **Profile**: The single record of developer information: name, professional title, personal introduction, biography, career interests, professional goals, profile image URL, email, GitHub URL and LinkedIn URL.
- **Settings**: The key/value store of website-wide values. The allowed keys are `site_title`, `hero_introduction`, `footer_text` and `social_links`.
- **Social_Link**: One entry in the `social_links` setting, made of a label (1–50 characters) and an http or https URL.
- **Project**: A portfolio project record, including its features list and its associated Technologies.
- **Published_Project**: A Project whose `is_published` value is true.
- **Slug**: A unique, URL-safe Project identifier that matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, is at most 160 characters long and contains at least one letter.
- **Project_Identifier**: The path parameter of `GET /api/projects/:identifier`. It is treated as an id when it contains only digits and as a Slug otherwise.
- **Slug_Generator**: The API_Server function that derives a Slug from a Project title.
- **Technology**: A named technology tag (for example "React") with an optional category. Projects reference Technologies through the `project_technologies` join table.
- **Skill**: A technical skill shown on the Skills page, with a name, category, optional proficiency level, optional icon URL and display order.
- **Proficiency_Level**: One of the values `Beginner`, `Intermediate`, `Advanced` or `Expert`.
- **Experience_Record**: A work experience entry, including an ordered list of responsibilities.
- **Employment_Type**: One of the values `Full-time`, `Part-time`, `Internship`, `Contract`, `Freelance` or `Volunteer`.
- **Education_Record**: An education entry: institution, qualification, field of study, start year, end year and description.
- **Contact_Message**: A message submitted by a Visitor through the Contact page, with a read/unread status.
- **Honeypot_Field**: A contact form field hidden from people. Automated spam tools tend to fill it in.
- **Dashboard_Stats**: The counts shown on the Admin_Dashboard overview.
- **Migration_Runner**: The API_Server script that applies versioned SQL migrations to the Database in order.
- **Seed_Script**: The API_Server script that creates the initial Administrator account and optional sample content.
- **Confirmation_Dialog**: A modal dialog in the Admin_Dashboard that asks the Administrator to confirm a destructive action.
- **Notification**: A short message in the Frontend reporting the success or failure of an action.
- **Valid_URL**: A string of at most 2048 characters that parses as an absolute URL with the `http` or `https` scheme.
- **Valid_Email**: A string of at most 254 characters that matches the format `local-part@domain` with at least one dot in the domain.

## Requirements

### Requirement 1: Project Structure and Layered Architecture

**User Story:** As a developer maintaining the portfolio, I want a clear monorepo structure with separated layers, so that I can find, change and test code without side effects.

#### Acceptance Criteria

1. THE Portfolio_System SHALL keep the Frontend source in a `client/` directory and the API_Server source in a `server/` directory under the repository root. Each of these directories SHALL contain its own `package.json` that declares that layer's dependencies and scripts.
2. THE Frontend SHALL get and change Database data only by sending HTTP requests through the API_Client to API_Server endpoints under the `/api` base path. No UI component, page, context or hook SHALL call `fetch` or any other HTTP function directly.
3. THE Frontend SHALL NOT list `pg` or any other database driver in `client/package.json`. The Frontend source and the Frontend environment variables SHALL NOT contain Database connection settings, Database credentials or the JWT signing secret.
4. THE API_Server SHALL organize code into separate directories for routes, controllers, services, middleware, validators, database configuration and utilities. Each directory SHALL contain only code of its own kind.
5. THE API_Server SHALL issue SQL queries only from service or database configuration modules. Route and controller modules SHALL NOT contain SQL statements.
6. THE API_Server SHALL limit the application entry file to three tasks: loading configuration, creating the Express application and starting the HTTP listener. The entry file SHALL NOT contain route handler logic, SQL statements or validation rules.
7. THE API_Server SHALL perform all Database operations with async/await and SHALL NOT use callback-style query functions.
8. IF a Database operation rejects during a request, THEN THE API_Server SHALL pass the error to the Error_Handler, return an Error_Response for that request, and keep the API_Server process running for later requests.
9. THE Frontend SHALL organize code into separate directories for reusable components, public pages, admin pages, context, hooks, API services, routes and utilities.
10. THE Portfolio_System SHALL include a root `.gitignore` that excludes every `node_modules` directory, the Vite build output directory of the Frontend, and every `.env` file except `.env.example`.
11. THE Portfolio_System SHALL include a `.env.example` file in `client/` and in `server/`. Each file SHALL list every environment variable that its layer reads, using placeholder values instead of real credentials or secrets.

### Requirement 2: Database Schema and Migrations

**User Story:** As a developer, I want a versioned database schema, so that I can recreate the database the same way in every environment.

#### Acceptance Criteria

1. THE Migration_Runner SHALL create the tables `admins`, `profile`, `projects`, `technologies`, `project_technologies`, `skills`, `experiences`, `education`, `contact_messages` and `settings` with the columns listed in the PRD. It SHALL also create the additional columns defined in this document: `admins.role`, `profile.personal_introduction`, `profile.career_interests`, `profile.professional_goals`, `projects.features` and `experiences.responsibilities`. `admins.role` SHALL be not null with a default value of `admin`. `projects.features` and `experiences.responsibilities` SHALL each store an ordered list of text items and default to an empty list.
2. THE Migration_Runner SHALL define a primary key on every table, a composite primary key `(project_id, technology_id)` on `project_technologies`, and unique constraints on `admins.email`, `projects.slug`, `settings.setting_key` and the case-insensitive value of `technologies.name`. As a result, the Database SHALL reject an insert or update that would create a second Technology whose name differs from an existing Technology name only in letter case (for example "react" when "React" exists).
3. THE Migration_Runner SHALL define foreign keys from `project_technologies.project_id` to `projects.id` and from `project_technologies.technology_id` to `technologies.id`, with cascading delete. Deleting a Project SHALL remove only that Project's `project_technologies` rows and SHALL leave the referenced Technologies in place. Deleting a Technology SHALL remove only that Technology's `project_technologies` rows and SHALL leave the referencing Projects in place.
4. THE Migration_Runner SHALL define indexes supporting the public listing queries, covering at least `projects(is_published, display_order)`, `skills(category, display_order)` and `contact_messages(is_read, created_at)`.
5. THE Migration_Runner SHALL define timestamp columns per the PRD: `admins`, `profile`, `projects`, `skills`, `experiences` and `education` SHALL have both `created_at` and `updated_at`; `technologies` and `contact_messages` SHALL have `created_at` only; `settings` SHALL have `updated_at` only; `project_technologies` and the migration tracking table SHALL have neither. Every timestamp column SHALL be not null and default to the Database's current timestamp when a row is inserted.
6. THE Migration_Runner SHALL record each applied migration in a tracking table, with the migration name and the timestamp when it was applied. On each run it SHALL apply only the migrations not yet recorded, in ascending order of migration version, with each migration in its own transaction.
7. WHEN the Migration_Runner runs against a Database that already has every migration applied, THE Migration_Runner SHALL leave the schema and the tracking table unchanged, report that no migrations are pending, and exit with status code 0.
8. IF a migration fails, THEN THE Migration_Runner SHALL roll back that migration's transaction, leave the failing migration unrecorded in the tracking table, apply none of the later migrations, keep any migrations applied earlier in the same run applied and recorded, report the failing migration name and the failure reason, and exit with a non-zero status code.
9. THE Migration_Runner SHALL define Database-level constraints requiring `experiences.end_date` to be null or not earlier than `experiences.start_date`, and `education.end_year` to be null or not less than `education.start_year`. The Database SHALL reject any insert or update that violates either constraint and SHALL leave the existing row unchanged.
10. WHEN the API_Server updates a row in a table that has an `updated_at` column, THE API_Server SHALL set `updated_at` to the current timestamp. The new `updated_at` SHALL be greater than or equal to its previous value, and `created_at` SHALL stay unchanged.
11. WHEN the Migration_Runner runs against an empty Database, THE Migration_Runner SHALL create the tracking table, apply every migration in ascending order of migration version, record each one in the tracking table, and exit with status code 0.
12. IF the Migration_Runner cannot connect to the Database using the configured connection settings, including the configured SSL setting, THEN THE Migration_Runner SHALL apply no migrations, report a message indicating the connection failure, and exit with a non-zero status code.

### Requirement 3: Initial Data Seeding

**User Story:** As the portfolio owner, I want to create my admin account and starter content securely, so that I can sign in for the first time without putting credentials in source code.

#### Acceptance Criteria

1. WHEN the Seed_Script runs with `ADMIN_EMAIL` set to a Valid_Email, `ADMIN_PASSWORD` set to a value of at least 12 characters and at most 72 bytes, and no admin account in the Database, THE Seed_Script SHALL create exactly one admin account whose email equals `ADMIN_EMAIL`, whose role is `admin` and whose stored password is a bcrypt hash of `ADMIN_PASSWORD`, and SHALL exit with status code 0.
2. IF `ADMIN_EMAIL` is unset, empty or not a Valid_Email, or `ADMIN_PASSWORD` is unset, empty, shorter than 12 characters or longer than 72 bytes, THEN THE Seed_Script SHALL exit with a non-zero status code and print a message naming each invalid variable, without writing any data to the Database.
3. WHEN the Seed_Script runs with valid `ADMIN_EMAIL` and `ADMIN_PASSWORD` and at least one admin account already exists in the Database, whether or not its email equals `ADMIN_EMAIL`, THE Seed_Script SHALL create no new admin account, SHALL leave the email, role and password hash of every existing admin account unchanged, SHALL report that an admin account already exists, and SHALL continue with the Profile, Settings and sample-content steps.
4. WHEN the Seed_Script runs with valid `ADMIN_EMAIL` and `ADMIN_PASSWORD`, THE Seed_Script SHALL create the single Profile row only if no Profile row exists, and SHALL create each of the four allowed Settings keys (`site_title`, `hero_introduction`, `footer_text`, `social_links`) that does not already exist with its default value, where the `social_links` default is an empty list. The Seed_Script SHALL leave existing Profile values and existing Settings values unchanged and SHALL create no Settings keys outside the four allowed keys.
5. WHERE the sample-content option is enabled, WHEN the Seed_Script runs with valid `ADMIN_EMAIL` and `ADMIN_PASSWORD` and the Database contains no Projects, Skills, Experience_Records or Education_Records, THE Seed_Script SHALL insert at least one sample Project, Skill, Experience_Record and Education_Record. Each inserted record SHALL satisfy the Validator rules for its type, and each sample Project's Slug SHALL match the Slug definition.
6. WHERE the sample-content option is enabled, IF the Database already contains at least one Project, Skill, Experience_Record or Education_Record, THEN THE Seed_Script SHALL insert no sample content, SHALL leave existing records unchanged, and SHALL report that sample content was skipped.
7. IF the Database connection fails, a required table is missing, or any write fails during a Seed_Script run, THEN THE Seed_Script SHALL roll back every write made during that run, exit with a non-zero status code, and print a message identifying the step that failed.
8. THE Seed_Script SHALL keep the value of `ADMIN_PASSWORD` out of standard output, standard error and all log output, including error messages.
9. THE Seed_Script SHALL read admin credentials only from the `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables, with no built-in default values, and no file committed to the repository SHALL contain an admin password value.

### Requirement 4: API Response Format and Error Handling

**User Story:** As a frontend developer, I want consistent JSON responses and status codes, so that the Frontend can handle every outcome the same way.

#### Acceptance Criteria

1. WHEN a request under `/api` completes successfully, THE API_Server SHALL return a JSON Success_Response with `success` set to `true`, the result in `data`, and status 200 for reads, updates and deletions or status 201 for creations.
2. IF one or more request parameters or body fields fail the Validator's rules, THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` array holds one entry for each invalid field, naming the field and giving the reason. The response SHALL list every invalid field in the request, and the API_Server SHALL leave the Database unchanged.
3. IF the id, Slug or Project_Identifier in a request path refers to no existing record, THEN THE API_Server SHALL return status 404 with an Error_Response and leave the Database unchanged.
4. IF the combination of HTTP method and path of a request under `/api` matches no API route, THEN THE API_Server SHALL return status 404 with an Error_Response.
5. IF a request body sent as JSON cannot be parsed as JSON, THEN THE API_Server SHALL return status 400 with an Error_Response and leave the Database unchanged.
6. IF a request body is larger than 100 KB (102,400 bytes), THEN THE API_Server SHALL return status 413 with an Error_Response and leave the Database unchanged.
7. IF a create or update request would store a value that already exists in a field that must be unique (for example a Project Slug), THEN THE API_Server SHALL return status 409 with an Error_Response whose `details` names the conflicting field, and SHALL leave the Database unchanged.
8. IF an unexpected error or a Database error occurs while the API_Server handles a request, THEN THE Error_Handler SHALL log on the server the request method, the request path, the error message and the stack trace, with no password or JWT values. The Error_Handler SHALL return status 500 with an Error_Response whose `message` gives no cause, and the Database SHALL keep no partial changes from that request.
9. WHILE `NODE_ENV` is `production`, THE Error_Handler SHALL exclude stack traces, SQL text, Database error messages and internal error messages from every Error_Response, whatever its status code.
10. IF a path parameter that expects a numeric id is not a positive integer from 1 to 2,147,483,647 written only in digits (no sign, decimal point or whitespace), THEN THE API_Server SHALL return status 400 with an Error_Response and leave the Database unchanged. This rule also covers a Project_Identifier made only of digits, such as `0`.
11. THE API_Server SHALL send every error response under `/api` as an Error_Response with `success` set to `false`, a non-empty `error.code` and a non-empty `error.message`. This includes 401, 403 and 429 responses from the Auth_Middleware, Role_Guard and Rate_Limiter.
12. IF a request fails more than one of the checks in criteria 2, 3, 5, 6, 7 and 10, THEN THE API_Server SHALL return only the response for the first failed check, in this order: body size (criterion 6), JSON syntax (criterion 5), path id format (criterion 10), field validation (criterion 2), resource existence (criterion 3), uniqueness (criterion 7).
13. THE API_Server SHALL return the same `error.code` value for every response from the same criterion in this requirement, so the Frontend can tell error types apart by `error.code` without reading `error.message`.

### Requirement 5: Administrator Login

**User Story:** As the Administrator, I want to sign in with my email and password, so that I can access the dashboard securely.

#### Acceptance Criteria

1. WHEN `POST /api/auth/login` receives a request that passes validation, whose email matches an admin account and whose password matches that account's stored bcrypt `password_hash`, THE API_Server SHALL return status 200 with a Success_Response whose `data` contains a newly signed JWT and the admin's id, email and role.
2. THE API_Server SHALL match the submitted email against admin accounts case-insensitively after removing leading and trailing whitespace, and SHALL compare the submitted password exactly as received, without trimming or changing case.
3. IF a login request passes validation but the email matches no admin account or the password does not match the stored bcrypt `password_hash`, THEN THE API_Server SHALL return status 401 with an Error_Response whose message is "Invalid email or password", using the same status, error code and message in both cases and issuing no JWT.
4. IF a login request lacks an email or a password, supplies an email or password that is not a string, supplies an email that is not a Valid_Email, supplies an empty password, or supplies a password longer than 72 bytes in UTF-8 encoding, THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` lists each invalid field and the reason, and SHALL issue no JWT.
5. THE API_Server SHALL verify each submitted password by a bcrypt comparison against the stored `password_hash`, which has a cost factor of at least 12, and SHALL perform a bcrypt comparison for every login request that passes validation, including requests whose email matches no admin account.
6. THE API_Server SHALL sign each JWT with the value of the `JWT_SECRET` environment variable and SHALL include the admin's id, email, role and an expiry time in the JWT.
7. THE API_Server SHALL set each JWT's expiry time to the issue time plus the duration in `JWT_EXPIRES_IN`, or plus 2 hours when `JWT_EXPIRES_IN` is not set.
8. THE API_Server SHALL exclude `password_hash` and the submitted password from every response body and from all server log output.
9. IF, when the API_Server starts, `JWT_SECRET` is missing or shorter than 32 characters, or `JWT_EXPIRES_IN` is set to a value other than a positive whole number of seconds or a positive whole number followed by `s`, `m`, `h` or `d` (for example `2h`), THEN THE API_Server SHALL log a configuration error naming the invalid variable without printing the value of `JWT_SECRET`, and SHALL exit with a non-zero status code before accepting any requests.
10. THE API_Server SHALL serve `POST /api/auth/login` without authentication and SHALL ignore any `Authorization` header on a login request, including a header carrying an expired or invalid JWT.

### Requirement 6: Session Verification and Logout

**User Story:** As the Administrator, I want my session restored when I reload the page and ended when I log out, so that I stay signed in only while I intend to.

#### Acceptance Criteria

1. WHEN a request to `GET /api/auth/me` passes the Auth_Middleware and the Role_Guard, THE API_Server SHALL return status 200 with a Success_Response whose data contains only the id, email and role of the admin account referenced by the JWT, as currently stored in the Database.
2. WHEN the Frontend loads with a stored JWT, THE Frontend SHALL send exactly one `GET /api/auth/me` request through the API_Client, keep the Auth_Context loading status true until that request completes, and set the Auth_Context to authenticated with the returned id, email and role only after a status 200 response.
3. WHEN the Administrator selects Logout, THE Frontend SHALL remove the stored JWT, clear the token and admin identity from the Auth_Context and navigate to `/admin/login` without sending any request to the API_Server, after which the API_Client SHALL attach no JWT to any request.
4. WHILE the Frontend shows an Admin_Dashboard page other than `/admin/login`, IF any API_Client request that carries the JWT receives status 401, THEN THE Frontend SHALL remove the stored JWT, clear the Auth_Context, remember the current path, navigate to `/admin/login` and show the message "Your session has expired. Please sign in again." exactly once, even when more than one in-flight request receives status 401.
5. THE Frontend SHALL exclude the `JWT_SECRET` value, the `ADMIN_PASSWORD` value and any reference to the `JWT_SECRET` and `ADMIN_PASSWORD` variable names from all Frontend source code and build output.
6. WHEN the Frontend loads with no stored JWT, THE Frontend SHALL set the Auth_Context to unauthenticated without sending a `GET /api/auth/me` request.
7. WHILE the Frontend shows a Public_Site page, IF the `GET /api/auth/me` request sent at load receives status 401, THEN THE Frontend SHALL remove the stored JWT, set the Auth_Context to unauthenticated, stay on the current page and show no message.
8. IF the `GET /api/auth/me` request sent at load fails with a network error or with a status other than 200 or 401, THEN THE Frontend SHALL keep the stored JWT, leave the Auth_Context not authenticated, and show an error message with a Retry button that repeats the request in place of Protected_Route content, instead of redirecting to `/admin/login`.

### Requirement 7: API Authorization

**User Story:** As the portfolio owner, I want every administrative endpoint protected, so that only I can change content or read messages.

#### Acceptance Criteria

1. THE API_Server SHALL apply the Auth_Middleware followed by the Role_Guard requiring the `admin` role to these endpoints: `GET /api/auth/me`, `PUT /api/profile`, `GET /api/admin/projects`, `GET /api/admin/projects/:id`, `POST /api/projects`, `PUT /api/projects/:id`, `PATCH /api/projects/:id/publish`, `DELETE /api/projects/:id`, `GET /api/technologies`, the POST, PUT and DELETE endpoints for skills, experiences and education, `GET /api/contact`, `GET /api/contact/:id`, `PATCH /api/contact/:id/read`, `DELETE /api/contact/:id`, `GET /api/dashboard/stats` and `PUT /api/settings`.
2. IF a protected endpoint receives a request that has no `Authorization` header, has an `Authorization` header with a scheme other than `Bearer`, or has a `Bearer` scheme with an empty token value, THEN THE Auth_Middleware SHALL return status 401 with an Error_Response.
3. IF a protected endpoint receives a JWT with a signature that does not verify, a malformed structure, a missing admin id or role claim, or an expiry time at or before the API_Server's current time, THEN THE Auth_Middleware SHALL return status 401 with an Error_Response.
4. IF a protected endpoint receives a JWT that passes the checks in criteria 2, 3 and 5 and carries a role other than `admin`, THEN THE Role_Guard SHALL return status 403 with an Error_Response.
5. IF a protected endpoint receives a JWT with a valid signature and an unexpired expiry time whose admin id does not exist in the Database, THEN THE Auth_Middleware SHALL return status 401 with an Error_Response.
6. THE API_Server SHALL serve `POST /api/auth/login`, `GET /api/health`, `GET /api/profile`, `GET /api/projects`, `GET /api/projects/:identifier`, `GET /api/skills`, `GET /api/experiences`, `GET /api/education`, `GET /api/settings` and `POST /api/contact` without authentication.
7. WHEN a protected endpoint receives a JWT that passes the checks in criteria 2, 3 and 5 and carries the `admin` role, THE Auth_Middleware SHALL attach the Administrator's admin id, email and role to the request, and THE API_Server SHALL pass the request on to the Validator and the endpoint handler.
8. IF the Auth_Middleware or the Role_Guard rejects a request with status 401 or 403, THEN THE API_Server SHALL send the response before the Validator runs, SHALL leave the Database unchanged, and SHALL include no protected data in the Error_Response.
9. WHEN an endpoint listed in criterion 6 receives a request with an `Authorization` header, whether its JWT is valid, invalid or expired, THE API_Server SHALL return the same status and body it returns for the same request without the header, and SHALL NOT return status 401 or 403.

### Requirement 8: Abuse Protection

**User Story:** As the portfolio owner, I want basic protection against password guessing and contact spam, so that my account and inbox stay usable.

#### Acceptance Criteria

1. IF a client IP address has made 5 failed login attempts within its current 15-minute login window, THEN THE Rate_Limiter SHALL reject every further `POST /api/auth/login` request from that IP address with status 429 and an Error_Response indicating too many login attempts until that window ends, without checking the submitted credentials, so that a request with correct credentials is also rejected. A failed login attempt is a `POST /api/auth/login` request that the API_Server rejects because the credentials are invalid. The 5th failed login attempt itself still receives the invalid-credentials response. Requests rejected by the Validator, requests rejected with status 429 and successful logins neither increase nor reset the count.
2. IF a client IP address has made 5 counted contact submissions within its current 60-minute contact window, THEN THE Rate_Limiter SHALL reject every further `POST /api/contact` request from that IP address with status 429 and an Error_Response indicating too many contact submissions until that window ends, without validating or storing the submitted message. A counted contact submission is a `POST /api/contact` request answered with status 201, including submissions discarded under criterion 4. Requests rejected by the Validator and requests rejected with status 429 are not counted.
3. WHEN the Rate_Limiter rejects a request with status 429, THE API_Server SHALL include a `Retry-After` header whose value is the whole number of seconds remaining in the current window, rounded up, between 1 and 900 for login rejections and between 1 and 3600 for contact rejections.
4. IF a `POST /api/contact` request contains a Honeypot_Field value of at least one character (whitespace included), THEN THE API_Server SHALL return status 201 with a Success_Response of the same shape as a stored submission returns, whatever the other fields contain, and SHALL discard the submission so that no Contact_Message is stored and Dashboard_Stats do not change.
5. WHERE the `TRUST_PROXY` configuration is enabled, THE Rate_Limiter SHALL identify clients by the forwarded client IP address supplied by the reverse proxy.
6. IF the `TRUST_PROXY` configuration is disabled or unset, THEN THE Rate_Limiter SHALL identify clients by the IP address of the direct network connection and SHALL ignore any client IP address supplied in forwarded request headers.
7. THE Rate_Limiter SHALL keep a separate count for each client IP address for login and for contact, in fixed windows. Each window starts at the first counted request from that IP address when no window for that endpoint is open, lasts 15 minutes for login and 60 minutes for contact, and its count returns to 0 when it ends. Requests to one endpoint do not change the count for the other endpoint, and requests from one IP address do not change the count for another IP address.
8. WHEN the API_Client receives a status 429 response to a login or contact form submission, THE Frontend SHALL show a message saying that too many attempts were made and asking the user to try again later, SHALL keep the entered email on the login form while clearing only the password as defined in Requirement 30 criterion 4, and SHALL keep all entered values on the contact form as defined in Requirement 29 criterion 7.

### Requirement 9: Security Configuration

**User Story:** As the portfolio owner, I want secure defaults throughout the backend, so that common attacks and configuration leaks are prevented.

#### Acceptance Criteria

1. THE API_Server SHALL execute every Database query with parameterized values, SHALL exclude request-supplied values from SQL text, and SHALL take any request-supplied column name or sort direction only from a fixed allow-list defined in the API_Server.
2. WHEN the API_Server receives a request that carries an `Origin` header, THE API_Server SHALL include cross-origin allow headers in the response only if the `Origin` value exactly matches the scheme, host and port of one entry in the `FRONTEND_URL` environment variable (entries separated by commas, with surrounding whitespace and a trailing slash ignored), and SHALL omit cross-origin allow headers for every other `Origin` value, including on preflight `OPTIONS` requests.
3. THE API_Server SHALL read the port, Database connection settings, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_URL`, `NODE_ENV`, `TRUST_PROXY`, the Database SSL setting and `DB_POOL_MAX` from environment variables. It SHALL apply a JWT lifetime of 2 hours when `JWT_EXPIRES_IN` is unset. It SHALL open Database connections with SSL only when the Database SSL setting is enabled. The Rate_Limiter SHALL use the proxy-forwarded client IP address only when `TRUST_PROXY` is enabled and the direct connection address otherwise. The API_Server source code SHALL contain no hard-coded value for `JWT_SECRET` or the Database password.
4. THE Portfolio_System SHALL provide a `server/.env.example` file that lists every environment variable named in criterion 3, and a `client/.env.example` file that lists every environment variable the Frontend reads. Each variable in both files SHALL have a placeholder value, and neither file SHALL contain a real secret, password or production URL. THE Portfolio_System SHALL exclude `server/.env` and `client/.env` from version control.
5. THE API_Server SHALL set the response headers `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`, and SHALL omit the `X-Powered-By` header, on every response. This includes Success_Responses, Error_Responses, responses for unknown routes, rate-limited responses and preflight `OPTIONS` responses.
6. IF a request body contains a field that is not defined for the endpoint, at any nesting level, THEN THE Validator SHALL reject the request with status 400 and an Error_Response whose `details` lists each unknown field name, and THE API_Server SHALL leave the Database unchanged. `POST /api/contact` is the only exception and follows Requirement 18 criterion 5.
7. THE Frontend SHALL render all Database-sourced text as escaped text and SHALL use no raw HTML injection for that content. THE Frontend SHALL use a Database-sourced URL as a link target or image source only when the URL is a Valid_URL. For any other value it SHALL render the value as plain text, or show the placeholder image when the value is an image URL.
8. IF `JWT_SECRET`, `FRONTEND_URL` or a required Database connection setting is unset or empty at startup, or `JWT_SECRET` is shorter than 32 characters, THEN THE API_Server SHALL exit with a non-zero exit code before accepting any request and SHALL write an error naming each invalid variable, without writing any variable's value.
9. WHILE `NODE_ENV` is `production`, IF an unexpected error occurs while the API_Server is handling a request, THEN THE Error_Handler SHALL respond with status 500 and an Error_Response with a generic message. That response SHALL contain no stack trace, SQL text, Database error detail, file path or environment variable value.
10. IF a request body is not well-formed JSON, THEN THE API_Server SHALL respond with status 400 and an Error_Response indicating a malformed body, and SHALL leave the Database unchanged.

### Requirement 10: Profile Management

**User Story:** As the Administrator, I want to edit my profile details, so that the public site shows current information about me.

#### Acceptance Criteria

1. WHEN a request to `GET /api/profile` is received, with or without a JWT, THE API_Server SHALL return status 200 with a Success_Response whose data contains exactly these ten Profile fields: name, professional title, personal introduction, biography, career interests, professional goals, profile image URL, email, GitHub URL and LinkedIn URL. Any optional field that has no value SHALL be returned as an empty string.
2. WHEN a `PUT /api/profile` request passes the Auth_Middleware, the Role_Guard and the Validator, THE API_Server SHALL trim leading and trailing whitespace from each submitted field and store the trimmed values in the single Profile row in one operation. THE API_Server SHALL leave omitted optional fields unchanged and return status 200 with a Success_Response containing all ten Profile fields as stored.
3. THE Validator SHALL require name, professional title and email to be present in every `PUT /api/profile` request. THE Validator SHALL accept name of 1–100 characters, professional title of 1–100 characters, a Valid_Email for email, and personal introduction, biography, career interests and professional goals of 0–5000 characters each. THE Validator SHALL measure every length after trimming leading and trailing whitespace, so a value that is only whitespace counts as empty.
4. THE Validator SHALL accept profile image URL, GitHub URL and LinkedIn URL only if each value is either empty after trimming or a Valid_URL.
5. WHEN a valid `PUT /api/profile` request submits the profile image URL, GitHub URL or LinkedIn URL as empty, THE API_Server SHALL store that field as empty, which clears the previous URL.
6. WHEN the Administrator submits the Profile form in the Admin_Dashboard, THE Frontend SHALL send all ten Profile fields through the API_Client to `PUT /api/profile` and SHALL disable the submit button until the response arrives.
7. WHEN `PUT /api/profile` returns status 200 for a Profile form submission, THE Frontend SHALL show a success Notification and fill the form with the returned Profile values.
8. IF a Profile form submission receives an Error_Response or the request fails, THEN THE Frontend SHALL show an error Notification, keep the entered values in the form and show each field error from the Error_Response `details` next to the matching form field.
9. FOR ALL valid Profile updates, a `GET /api/profile` request made after a successful `PUT /api/profile` SHALL return each submitted field equal to its submitted value with leading and trailing whitespace trimmed, and each omitted optional field equal to its value before the update (round-trip property).
10. IF a `PUT /api/profile` request is missing name, professional title or email, has any field outside its allowed length, has an email that is not a Valid_Email, has a URL field that is neither empty nor a Valid_URL, or contains a field that is not one of the ten Profile fields, THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` lists each invalid field and the reason, and SHALL leave all ten stored Profile fields unchanged.
11. WHEN the Administrator opens the Profile form in the Admin_Dashboard, THE Frontend SHALL request `GET /api/profile` through the API_Client and fill each of the ten form fields with the returned value before enabling the submit button.
12. IF the Profile row does not exist in the Database, THEN THE API_Server SHALL return status 404 with an Error_Response for both `GET /api/profile` and `PUT /api/profile`, and SHALL NOT create a Profile row.

### Requirement 11: Website Settings Management

**User Story:** As the Administrator, I want to edit the site title, hero text, footer text and extra social links, so that I can change site-wide content without code changes.

#### Acceptance Criteria

1. WHEN a request to `GET /api/settings` is received, THE API_Server SHALL return status 200 with a Success_Response whose data contains exactly the keys `site_title`, `hero_introduction`, `footer_text` and `social_links`, returning an empty string for any text key with no stored value and an empty list for `social_links` when no value is stored.
2. WHEN a valid request to `PUT /api/settings` is received from the Administrator, THE API_Server SHALL store the values of the keys present in the request with leading and trailing whitespace trimmed from `site_title`, `hero_introduction`, `footer_text` and each Social_Link label, leave every omitted key unchanged, and return status 200 with a Success_Response containing the full Settings object.
3. IF a `PUT /api/settings` request contains a key outside `site_title`, `hero_introduction`, `footer_text` and `social_links`, THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` names each disallowed key, and SHALL leave all Settings unchanged, including allowed keys sent in the same request.
4. THE Validator SHALL accept `site_title` as a string of 1–100 characters after trimming, `hero_introduction` as a string of 0–500 characters after trimming, `footer_text` as a string of 0–300 characters after trimming, and `social_links` as a list of 0–10 Social_Links in which each entry contains only a label of 1–50 characters after trimming and a `url` that is a Valid_URL.
5. FOR ALL valid `social_links` lists of 0–10 Social_Links, saving through `PUT /api/settings` and then reading through `GET /api/settings` SHALL return a list of the same length with the same trimmed labels and the same URLs in the same order (round-trip property).
6. WHEN the Public_Site loads a page after a successful `PUT /api/settings`, THE Public_Site SHALL show the stored `site_title` as the browser tab title, the stored `hero_introduction` on the Home page, the stored `footer_text` in the footer, and one footer link per Social_Link in stored order, using the label as the link text and the URL as the link target, with no extra footer links shown when `social_links` is an empty list.
7. IF a `PUT /api/settings` request contains a value that breaks a rule in criterion 4, including a value of the wrong type such as a non-string text key or a non-list `social_links`, THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` lists each invalid field and the reason, and SHALL leave all Settings unchanged, including valid keys sent in the same request.
8. IF a `PUT /api/settings` request body contains none of the allowed keys, THEN THE API_Server SHALL return status 400 with an Error_Response and leave all Settings unchanged.
9. WHEN the Administrator submits the Settings form in the Admin_Dashboard, THE Frontend SHALL send the changed values to `PUT /api/settings`, show a success Notification after a status 200 response, and show an error Notification while keeping the entered form values after any error response.

### Requirement 12: Public Project Retrieval

**User Story:** As a Visitor, I want to browse published projects and open a project by its readable URL, so that I can evaluate the developer's work.

#### Acceptance Criteria

1. WHEN a request to `GET /api/projects` is received, THE API_Server SHALL return status 200 with a Success_Response whose `data` is a list containing only Published_Projects, ordered by `display_order` ascending and then by `created_at` descending, with each Project including its Technologies.
2. WHERE a `category` query parameter of 1–50 characters is supplied to `GET /api/projects`, THE API_Server SHALL return only Published_Projects whose category equals the supplied value, compared case-insensitively, in the order defined in criterion 1.
3. WHEN a request to `GET /api/projects/:identifier` has a Project_Identifier made only of digits, THE API_Server SHALL look up the Project whose id equals the integer value of those digits.
4. WHEN a request to `GET /api/projects/:identifier` has a Project_Identifier that contains a non-digit character, THE API_Server SHALL look up the Project whose Slug exactly equals the Project_Identifier, compared case-sensitively.
5. IF no Project matches the Project_Identifier of a `GET /api/projects/:identifier` request, including a digit-only value larger than any stored id and a value that does not satisfy the Slug format, or the matching Project is not a Published_Project, THEN THE API_Server SHALL return status 404 with an Error_Response that contains no Project fields and is the same for an unpublished Project as for a nonexistent Project.
6. THE API_Server SHALL return the same response from `GET /api/projects` and `GET /api/projects/:identifier` whether the request carries no JWT, a valid JWT, or an invalid or expired JWT, and SHALL NOT reject these requests with status 401 or 403.
7. FOR ALL Projects in the Database, the set returned by `GET /api/projects` without a `category` query parameter SHALL equal the subset of Projects whose `is_published` value is true (invariant).
8. WHEN a request to `GET /api/projects/:identifier` matches a Published_Project, THE API_Server SHALL return status 200 with a Success_Response containing the Project's title, Slug, short description, full description, problem statement, objectives, challenges, solutions, category, image URL, GitHub URL, live demo URL, `display_order`, its features list in stored order, and its Technologies.
9. IF no Published_Project satisfies a `GET /api/projects` request, because no Project is published or no Published_Project has the requested category, THEN THE API_Server SHALL return status 200 with a Success_Response whose `data` is an empty list.
10. IF the `category` query parameter of a `GET /api/projects` request is empty, contains only whitespace or is longer than 50 characters, THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` identifies the `category` field.

### Requirement 13: Project Administration

**User Story:** As the Administrator, I want to create, edit, publish, unpublish and delete projects, so that my portfolio shows the work I choose.

#### Acceptance Criteria

1. WHEN the Administrator requests `GET /api/admin/projects`, THE API_Server SHALL return status 200 with a Success_Response listing every Project, published and unpublished, each with its features, Technologies and `is_published` value, ordered by `display_order` ascending and then by `created_at` descending, and SHALL return an empty list when no Project exists.
2. WHEN the Administrator requests `GET /api/admin/projects/:id` with an id that matches a Project, THE API_Server SHALL return status 200 with a Success_Response containing that Project's fields, features in stored order, Technologies and `is_published` value, whether or not the Project is a Published_Project.
3. WHEN a request to `POST /api/projects` from the Administrator passes all rules in criteria 7–9 and 13, THE API_Server SHALL create the Project with its features and Technologies and return status 201 with a Success_Response containing the created Project, including its assigned id, Slug, `is_published` value, features and Technologies.
4. WHEN a request to `PUT /api/projects/:id` from the Administrator passes all rules in criteria 7–9 and 13 for an existing Project, THE API_Server SHALL replace the Project's fields, replace its features list with the submitted list in the submitted order, replace its Technology associations with exactly the submitted Technologies, and return status 200 with a Success_Response containing the updated Project.
5. WHEN a request to `PATCH /api/projects/:id/publish` from the Administrator carries a boolean `is_published` value for an existing Project, THE API_Server SHALL set the Project's `is_published` value to the submitted value, leave all other Project fields, features and Technology associations unchanged, and return status 200 with a Success_Response containing the updated Project, including when the Project already had the submitted value.
6. WHEN a request to `DELETE /api/projects/:id` from the Administrator references an existing Project, THE API_Server SHALL delete the Project and its `project_technologies` rows, keep every Technology record, and return status 200 with a Success_Response, after which `GET /api/admin/projects/:id` and `GET /api/projects/:identifier` for that Project SHALL return status 404.
7. THE Validator SHALL require title (1–150 characters), short description (1–300 characters) and category (1–50 characters), each measured after trimming leading and trailing whitespace so that whitespace-only values fail, and SHALL accept full description, problem statement, objectives, challenges and solutions as omitted, empty or up to 10000 characters each.
8. THE Validator SHALL require image URL, GitHub URL and live demo URL to be omitted, empty or a Valid_URL, `display_order` to be an integer from 0 to 9999, and `is_published`, when supplied to `POST /api/projects` or `PUT /api/projects/:id`, to be a boolean.
9. THE Validator SHALL accept features as a list of 0 to 30 items of 1–300 characters each after trimming leading and trailing whitespace, and Technologies as a list of 0 to 30 names of 1–50 characters each after trimming, with no two names equal when compared case-insensitively.
10. WHEN a Project is created with the Slug omitted or empty, THE Slug_Generator SHALL derive the Slug from the title by lowercasing it, replacing each run of characters other than `a`–`z` and `0`–`9` with one hyphen, trimming leading and trailing hyphens, and truncating the result at a hyphen boundary or character limit so that the final Slug, including any suffix from criterion 11, is at most 160 characters with no trailing hyphen.
11. IF a Slug produced by criteria 10 and 12 already belongs to another Project, THEN THE Slug_Generator SHALL append the smallest suffix from `-2`, `-3`, and so on, that makes the Slug unique among all Projects.
12. IF a Slug derived under criterion 10 contains no letter, THEN THE Slug_Generator SHALL prefix it with `project-`, or SHALL use `project` when the derived Slug is empty.
13. IF a `POST /api/projects` or `PUT /api/projects/:id` request breaks any rule in criteria 7–9 or supplies a non-empty Slug that does not match the Slug format, THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` lists each invalid field, and SHALL leave all Projects, Technologies and `project_technologies` rows unchanged.
14. THE Slug_Generator SHALL produce, for every title, an output that matches the Slug format, and applying the derivation in criteria 10 and 12 (without the suffix in criterion 11) to an existing Slug SHALL return that Slug unchanged (idempotence property).
15. FOR ALL valid Project payloads, creating a Project and then reading it through `GET /api/admin/projects/:id` SHALL return the same field values, the same features in the same order and the same set of Technology names compared case-insensitively (round-trip property).
16. WHEN a Project is created or updated with `is_published` omitted, THE API_Server SHALL set the Project unpublished on creation and keep the existing `is_published` value on update, and WHEN a Project is updated with the Slug omitted or empty, THE API_Server SHALL keep the existing Slug.
17. IF a request to `GET /api/admin/projects/:id`, `PUT /api/projects/:id`, `PATCH /api/projects/:id/publish` or `DELETE /api/projects/:id` carries an id that matches no Project, THEN THE API_Server SHALL return status 404 with an Error_Response and SHALL leave all Projects, Technologies and `project_technologies` rows unchanged.
18. IF an Administrator-supplied Slug on `POST /api/projects` or `PUT /api/projects/:id` matches the Slug format but already belongs to a Project other than the one being updated, THEN THE API_Server SHALL return status 409 with an Error_Response and SHALL leave all Projects, Technologies and `project_technologies` rows unchanged.
19. IF a request to `PATCH /api/projects/:id/publish` omits `is_published` or carries a non-boolean `is_published` value, THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` names the `is_published` field, and SHALL leave the Project's `is_published` value unchanged.

### Requirement 14: Technology Tags

**User Story:** As the Administrator, I want to tag projects with technologies by name, so that visitors see each project's stack without me managing a separate list.

#### Acceptance Criteria

1. WHEN a Project is saved through `POST /api/projects` or `PUT /api/projects/:id` with a Technology name that, after leading and trailing whitespace is trimmed, matches an existing Technology name case-insensitively, THE API_Server SHALL associate the Project with the existing Technology and leave that Technology's stored name and category unchanged.
2. WHEN a Project is saved through `POST /api/projects` or `PUT /api/projects/:id` with a Technology name that, after leading and trailing whitespace is trimmed, matches no existing Technology name case-insensitively, THE API_Server SHALL create one Technology whose name is the trimmed submitted name in its submitted letter case and whose category is empty, and SHALL associate the Project with the new Technology.
3. WHEN the Administrator requests `GET /api/technologies`, THE API_Server SHALL return a Success_Response whose data lists every Technology with its id, name and category, ordered by name ascending using case-insensitive comparison, for use as suggestions in the Project form, and SHALL return an empty list when no Technology exists.
4. THE API_Server SHALL save each Project, every Technology created for it and all of its Technology associations in a single Database transaction.
5. IF any step of saving a Project, creating a Technology for it or writing its Technology associations fails, THEN THE API_Server SHALL roll back the whole Database transaction, so that the Project fields, the set of Technologies and the Project's Technology associations remain exactly as they were before the request, and SHALL return an Error_Response.
6. IF a Project payload contains a Technology name that is empty or longer than 50 characters after trimming, or contains two Technology names that are equal after trimming and case-insensitive comparison, THEN THE Validator SHALL reject the request with status 400 and an Error_Response whose details identify each offending Technology entry, and THE API_Server SHALL store no Project, Technology or association changes from that request.
7. WHEN a Project is saved through `POST /api/projects` or `PUT /api/projects/:id` with an empty Technology list, THE API_Server SHALL leave the Project with zero Technology associations, and on update SHALL remove each association to a Technology whose name is absent from the submitted list while keeping that Technology record in the Database.

### Requirement 15: Skills

**User Story:** As the Administrator, I want to manage skills grouped by category with a custom order, so that visitors see my strongest areas clearly.

#### Acceptance Criteria

1. WHEN a request to `GET /api/skills` is received, THE API_Server SHALL return status 200 with a Success_Response containing all Skills, ordered by category ascending (compared case-insensitively), then by `display_order` ascending, then by name ascending (compared case-insensitively), then by id ascending, and containing an empty list when no Skills exist.
2. WHEN a valid request to `POST /api/skills` is received from the Administrator, THE API_Server SHALL create the Skill and return status 201 with a Success_Response containing the created Skill's id, name, category, proficiency level, icon URL and `display_order`.
3. THE Validator SHALL trim leading and trailing whitespace from name and category, SHALL require name (1–50 characters after trimming), category (1–50 characters after trimming) and `display_order` (an integer value from 0 to 9999, rejecting decimals and numeric strings), and SHALL accept proficiency level as empty or an exact, case-sensitive Proficiency_Level value and icon URL as empty or a Valid_URL.
4. THE Admin_Dashboard SHALL offer the categories Frontend Development, Backend Development, Database, Programming Languages and Development Tools as suggestions in the Skill form, and SHALL accept any other category name of 1–50 characters entered by the Administrator.
5. WHEN the Administrator moves a Skill up or down in the Admin_Dashboard skills list, THE Frontend SHALL swap the `display_order` values of the Skill and the adjacent Skill in the same category (adjacent in the order returned by `GET /api/skills`), save both Skills through `PUT /api/skills/:id`, and reload the list from `GET /api/skills` after both requests complete. If the two `display_order` values are equal, THE Frontend SHALL instead assign that category's Skills the values 0, 1, 2 and so on in the order that results from the move, and save each Skill whose value changed. THE Frontend SHALL disable the move-up control for the first Skill in each category and the move-down control for the last Skill in each category.
6. FOR ALL lists of Skills returned by `GET /api/skills`, every Skill stored in the Database SHALL appear exactly once and the list SHALL follow the ordering defined in criterion 1 (invariant).
7. WHEN a valid request to `PUT /api/skills/:id` or `DELETE /api/skills/:id` from the Administrator names an existing Skill, THE API_Server SHALL either replace the Skill's name, category, proficiency level, icon URL and `display_order` with the submitted values (setting omitted optional fields to empty) and return status 200 with the updated Skill, or delete the Skill and return status 200, after which `GET /api/skills` no longer includes the deleted Skill.
8. IF a `POST /api/skills` or `PUT /api/skills/:id` request fails validation, or a `PUT /api/skills/:id` or `DELETE /api/skills/:id` request names an id that matches no Skill, THEN THE API_Server SHALL return status 400 or status 404 respectively with an Error_Response and leave all stored Skills unchanged.
9. IF any `PUT /api/skills/:id` request sent for a move fails, THEN THE Frontend SHALL show an error Notification and reload the skills list from `GET /api/skills`, so that the displayed order matches the stored order.

### Requirement 16: Experience Records

**User Story:** As the Administrator, I want to manage my work experience including responsibilities, so that recruiters see what I did in each role.

#### Acceptance Criteria

1. WHEN a request to `GET /api/experiences` is received, THE API_Server SHALL return status 200 with a Success_Response whose `data` is a list of all Experience_Records, each including its responsibilities, ordered by start date descending and then by id descending for records with the same start date, and SHALL return an empty list when no Experience_Records exist.
2. WHEN a valid request to `POST /api/experiences` or `PUT /api/experiences/:id` is received from the Administrator, THE API_Server SHALL save the Experience_Record and return a Success_Response containing the saved record with its id and responsibilities, using status 201 for a creation and status 200 for an update, where an update replaces every submitted field, including the whole responsibilities list.
3. THE Validator SHALL require a job title of 1–100 characters and a company name of 1–100 characters, both counted after removing leading and trailing whitespace, an Employment_Type, and a start date that is a real calendar date in `YYYY-MM-DD` format, and SHALL accept a description that is empty, absent or up to 5000 characters.
4. THE Validator SHALL accept an end date that is empty, absent or a real calendar date in `YYYY-MM-DD` format that is equal to or later than the start date.
5. IF the end date is earlier than the start date, THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` contains a field error for the end date, and SHALL leave the Database unchanged.
6. THE Validator SHALL accept responsibilities as an absent or empty list, stored as an empty list, or as a list of at most 20 text items, each 1–300 characters long after removing leading and trailing whitespace, and SHALL reject a list of 21 or more items, a non-text item, or an item that is empty or whitespace-only.
7. FOR ALL valid Experience_Record payloads, creating or updating the record and then reading it through `GET /api/experiences` SHALL return the same responsibilities in the same order (round-trip property).
8. IF a request to `POST /api/experiences` or `PUT /api/experiences/:id` fails any rule in criteria 3, 4 or 6, or carries an Employment_Type value outside the defined set, THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` lists each invalid field and the reason, and SHALL leave the Database unchanged.
9. WHEN a valid request to `DELETE /api/experiences/:id` is received from the Administrator, THE API_Server SHALL delete the Experience_Record, return status 200 with a Success_Response, and exclude the record from every later `GET /api/experiences` response.
10. IF a request to `PUT /api/experiences/:id` or `DELETE /api/experiences/:id` references an id that matches no Experience_Record, THEN THE API_Server SHALL return status 404 with an Error_Response and SHALL leave the Database unchanged.

### Requirement 17: Education Records

**User Story:** As the Administrator, I want to manage my education history, so that recruiters see my qualifications.

#### Acceptance Criteria

1. WHEN a request to `GET /api/education` is received, THE API_Server SHALL return status 200 with a Success_Response containing every Education_Record (id, institution, qualification, field of study, start year, end year and description), ordered by start year descending, then by end year descending with records that have no end year placed first, then by id ascending, and SHALL return an empty list when no Education_Records exist.
2. WHEN a valid request to `POST /api/education` or `PUT /api/education/:id` is received from the Administrator, THE API_Server SHALL create a new Education_Record for `POST` or replace all fields of the existing Education_Record for `PUT`, and return the stored Education_Record in a Success_Response with status 201 for `POST` or status 200 for `PUT`.
3. THE Validator SHALL require institution (1–150 characters), qualification (1–150 characters) and a start year that is an integer from 1950 to the current year plus 10. It SHALL accept field of study of up to 150 characters, a description of up to 5000 characters, and an end year that is either empty or an integer from the start year to the current year plus 10. Text lengths SHALL be measured after trimming leading and trailing whitespace, and the current year SHALL be the calendar year on the API_Server's clock when the request is received.
4. IF the end year is present and is not an integer, is less than the start year, or is greater than the current year plus 10, THEN THE API_Server SHALL return status 400 with an Error_Response containing a field error for the end year, and SHALL leave the Database unchanged.
5. WHEN a request to `DELETE /api/education/:id` for an existing Education_Record is received from the Administrator, THE API_Server SHALL delete that Education_Record, return status 200 with a Success_Response, and exclude the record from all later `GET /api/education` responses.
6. IF a `PUT /api/education/:id` or `DELETE /api/education/:id` request has an id that is a positive integer but matches no Education_Record, THEN THE API_Server SHALL return status 404 with an Error_Response and leave all Education_Records unchanged.
7. FOR ALL valid Education_Record payloads, creating the record through `POST /api/education` and then reading it through `GET /api/education` SHALL return a record with the same institution, qualification, field of study, start year, end year and description as the trimmed submitted values (round-trip property).

### Requirement 18: Contact Message Submission

**User Story:** As a Visitor, I want to send the developer a message, so that I can start a conversation about an opportunity.

#### Acceptance Criteria

1. WHEN a `POST /api/contact` request is received whose name, email, subject and message all pass the Validator rules in criterion 2 and whose Honeypot_Field is absent or empty, THE API_Server SHALL store exactly one Contact_Message containing the sanitized name, email, subject and message, with `is_read` set to false and `created_at` set to the current timestamp, and return status 201 with a Success_Response that has the same structure as the response returned for a discarded Honeypot_Field submission in Requirement 8, criterion 4.
2. THE Validator SHALL require name to be a string of 1–100 characters, email to be a string that is a Valid_Email, subject to be a string of 1–150 characters and message to be a string of 10–5000 characters, with every length counted in Unicode code points after the sanitizing in criterion 4.
3. IF the Honeypot_Field is absent or empty and the request body is not a JSON object, or any of name, email, subject or message is missing, not a string, empty after sanitizing or outside its allowed range, THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` contains one entry for each invalid field, naming the field and the rule it failed, and SHALL store no Contact_Message.
4. WHEN the API_Server processes a contact submission, THE API_Server SHALL remove from each of name, email, subject and message every control character in the ranges U+0000–U+001F and U+007F except tab (U+0009), line feed (U+000A) and carriage return (U+000D), and SHALL then trim leading and trailing whitespace, before validating and storing the values.
5. WHEN a `POST /api/contact` request contains fields other than name, email, subject, message and the Honeypot_Field (for example `id`, `is_read` or `created_at`), THE API_Server SHALL ignore those fields and SHALL set `id`, `is_read` and `created_at` only as defined in criterion 1.
6. IF the Database fails while the API_Server is storing a Contact_Message, THEN THE API_Server SHALL return status 500 with a generic Error_Response that does not reveal Database details, and SHALL leave no Contact_Message from that request stored.
7. FOR ALL submitted contact payloads with an absent or empty Honeypot_Field, the API_Server SHALL either store exactly one Contact_Message and return status 201, or store no Contact_Message and return an Error_Response (status 400, 429 or 500) (invariant).

### Requirement 19: Contact Message Management

**User Story:** As the Administrator, I want to read, triage and delete contact messages, so that I can respond to opportunities and clear out noise.

#### Acceptance Criteria

1. WHEN the Administrator requests `GET /api/contact`, THE API_Server SHALL return status 200 with a Success_Response whose `data` lists the Contact_Messages for the requested page. The list SHALL be ordered by `created_at` descending, with ties ordered by id descending. Pagination SHALL use a `page` parameter (positive integer, default 1) and a `limit` parameter (integer from 1 to 100, default 20). `meta` SHALL contain the total count of matching Contact_Messages, the applied `page` and the applied `limit`. `data` SHALL be an empty list when no Contact_Messages match or when `page` is beyond the last page.
2. WHEN a `GET /api/contact` request includes an `is_read` query parameter with the value `true` or `false`, THE API_Server SHALL return only Contact_Messages with that read status and SHALL compute the total count in `meta` over the filtered set.
3. WHEN the Administrator requests `GET /api/contact/:id` for an existing Contact_Message, THE API_Server SHALL return status 200 with a Success_Response containing the Contact_Message's id, name, email, subject, full message text, read status and creation time, and SHALL leave the read status unchanged.
4. WHEN a `PATCH /api/contact/:id/read` request from the Administrator contains a JSON boolean `is_read` value and targets an existing Contact_Message, THE API_Server SHALL set the read status to that value, leave all other Contact_Message fields unchanged, and return status 200 with a Success_Response containing the updated Contact_Message. The request SHALL also succeed when the value equals the current read status.
5. WHEN the Administrator opens a Contact_Message's details in the Admin_Dashboard, THE Frontend SHALL show the sender name, email, subject, full message text and received date.
6. WHEN the Administrator opens the details of an unread Contact_Message in the Admin_Dashboard, THE Frontend SHALL send `PATCH /api/contact/:id/read` with `is_read` set to true and, after a successful response, show the Contact_Message as read in the message list without a page reload.
7. WHEN the Administrator selects the mark-as-read or mark-as-unread control for a Contact_Message in the message list or the details view, THE Frontend SHALL send `PATCH /api/contact/:id/read` with the matching `is_read` value and, after a successful response, show the new read status in the message list without a page reload.
8. WHEN a `DELETE /api/contact/:id` request from the Administrator targets an existing Contact_Message, THE API_Server SHALL permanently remove the Contact_Message from the Database and return status 200 with a Success_Response. After that, `GET /api/contact/:id` for that id SHALL return status 404, and the Contact_Message SHALL be excluded from `GET /api/contact` results and total counts.
9. THE Admin_Dashboard message list SHALL show a text label indicating unread status on every unread Contact_Message row and on no read row, together with a styling difference between unread and read rows.
10. IF a `GET /api/contact` request has a `page` that is not a positive integer, a `limit` that is not an integer from 1 to 100, or an `is_read` value other than `true` or `false`, THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` names each invalid parameter, and SHALL return no Contact_Messages.
11. IF a `PATCH /api/contact/:id/read` request body has no `is_read` field, or `is_read` is not a JSON boolean (including the strings `"true"` and `"false"`), THEN THE API_Server SHALL return status 400 with an Error_Response whose `details` identifies the `is_read` field, and SHALL leave the read status unchanged.
12. IF the `PATCH /api/contact/:id/read` request that the Frontend sends when the Administrator opens an unread Contact_Message fails, THEN THE Frontend SHALL keep showing the message details, keep the Contact_Message labeled as unread in the message list, and show a Notification saying the read status was not updated.

### Requirement 20: Dashboard Overview

**User Story:** As the Administrator, I want summary counts when I sign in, so that I can see the state of my content at a glance.

#### Acceptance Criteria

1. WHEN the Administrator sends `GET /api/dashboard/stats` with a valid JWT carrying the `admin` role, THE API_Server SHALL return status 200 with a Success_Response whose data contains seven non-negative integer counts: total Projects, Published_Projects, Skills, Experience_Records, Education_Records, total Contact_Messages and unread Contact_Messages.
2. WHEN the Admin_Dashboard overview page at `/admin` loads, THE Frontend SHALL request `GET /api/dashboard/stats` through the API_Client and show seven summary cards, one per Dashboard_Stats count, each showing a label naming the count and its integer value, including cards whose value is 0.
3. THE Admin_Dashboard overview page SHALL link the Projects and Published_Projects cards to the Projects management page, the Skills card to the Skills management page, the Experience_Records card to the Experience management page, the Education_Records card to the Education management page, and the total and unread Contact_Messages cards to the Messages page, using the same destinations as the matching sidebar links.
4. FOR ALL Database states with no concurrent writes during the request, `GET /api/dashboard/stats` SHALL return counts equal to the Database contents at the time the request is processed: the total Projects count equals all Project rows, the Published_Projects count equals Projects whose `is_published` value is true, the Skills, Experience_Records, Education_Records and total Contact_Messages counts equal all rows in their tables, the unread Contact_Messages count equals Contact_Messages with unread status, every count is 0 for an empty table, the Published_Projects count never exceeds the total Projects count, and the unread count never exceeds the total Contact_Messages count (invariant).
5. IF `GET /api/dashboard/stats` receives a request without a valid JWT or with a JWT whose role is not `admin`, THEN THE API_Server SHALL return status 401 or 403 respectively with an Error_Response, as defined in Requirement 7, and SHALL return no counts.
6. IF the Database query for any Dashboard_Stats count fails, THEN THE API_Server SHALL return status 500 with an Error_Response produced by the Error_Handler and SHALL return no partial counts.
7. IF the `GET /api/dashboard/stats` request fails, THEN THE Admin_Dashboard overview page SHALL show an error message with a Retry button in place of the summary cards, show no previously loaded or placeholder count values, and repeat the request when the Administrator selects Retry.

### Requirement 21: Public Layout and Navigation

**User Story:** As a Visitor, I want consistent navigation and a footer on every public page, so that I can move around the site easily.

#### Acceptance Criteria

1. THE Public_Site SHALL show a navigation bar at the top of every Public_Site page, including the not-found page, with links in the order Home, About, Skills, Projects, Experience, Education and Contact, and each link SHALL open its page without a full browser page reload.
2. WHEN a Public_Site page renders, THE Public_Site SHALL mark exactly one navigation link as active with a visual style different from the inactive links and with `aria-current="page"`, using these rules: the Home link only on the Home page, the Projects link on the Projects page and on every Project Details page, and the link for the current page on every other page. On the not-found page, no navigation link SHALL be marked active.
3. WHILE the viewport width is below 768 pixels, THE Public_Site SHALL hide the navigation links behind a menu toggle button that has an accessible name, starts collapsed on page load, and sets `aria-expanded` to "true" while the menu is open and "false" while it is closed.
4. THE Public_Site SHALL show a footer at the bottom of every Public_Site page, including the not-found page, containing the `footer_text` from Settings, links to the Profile GitHub URL and LinkedIn URL, one link per Social_Link from Settings (using its label as the link text, in stored order) and the current four-digit year from the Visitor's device clock. Each GitHub, LinkedIn and Social_Link link SHALL open in a new tab with `rel="noopener noreferrer"`, and the footer SHALL omit the footer text, the GitHub link, the LinkedIn link or the Social_Links when the matching value is empty.
5. WHEN a Visitor navigates to a path that matches no Public_Site route and does not start with `/admin`, THE Frontend SHALL show a not-found page with the public navigation bar and footer, one `h1` heading stating that the page was not found and a link to the Home page, and SHALL keep the requested path in the address bar.
6. WHEN a Visitor navigates to a Public_Site page, THE Frontend SHALL set the document title to the page name, the separator " | " and the `site_title` from Settings. The page name SHALL be the navigation label for that page, the Project title on a Project Details page after the Project loads, and "Page not found" on the not-found page.
7. WHILE the viewport width is 768 pixels or more, THE Public_Site SHALL show all navigation links inline and SHALL NOT show the menu toggle button.
8. WHILE the viewport width is below 768 pixels and the navigation menu is open, WHEN the Visitor selects a navigation link or presses the Escape key, THE Public_Site SHALL close the menu and set `aria-expanded` on the toggle button to "false". After the Escape key, it SHALL also move keyboard focus to the toggle button.
9. IF the `GET /api/settings` or `GET /api/profile` data used by the layout is still loading or the request failed, THEN THE Public_Site SHALL still show the navigation bar and the page content, SHALL omit the footer items that depend on the unavailable data, and SHALL set the document title to the page name alone until `site_title` is available.

### Requirement 22: Home Page

**User Story:** As a recruiter, I want a clear landing page, so that I can understand who the developer is within a few seconds.

#### Acceptance Criteria

1. WHEN the Home page has loaded the Profile from `GET /api/profile` and the Settings from `GET /api/settings`, THE Public_Site SHALL show the Profile name as the page's only level-1 heading, the Profile professional title, the full `hero_introduction` value from Settings without truncation, and the profile image with alternative text containing the Profile name.
2. IF the Profile has an empty profile image URL or the image at that URL fails to load, THEN THE Public_Site SHALL show a placeholder image in the profile image position with alternative text containing the Profile name.
3. THE Home page SHALL show a "View Projects" button that navigates to the Projects page and a "Contact Me" button that navigates to the Contact page, each in the same browser tab.
4. WHEN the Home page shows Profile data and the Profile has a non-empty GitHub URL or LinkedIn URL, THE Home page SHALL show a link labelled "GitHub" for the GitHub URL and a link labelled "LinkedIn" for the LinkedIn URL, each opening in a new tab with `target="_blank"` and `rel="noopener noreferrer"`.
5. IF the Profile GitHub URL or LinkedIn URL is empty, THEN THE Home page SHALL omit the link for that URL and show no empty or placeholder link in its place.
6. IF the `hero_introduction` value in Settings is empty, THEN THE Home page SHALL omit the hero introduction element and still show the Profile name and professional title.
7. IF `GET /api/profile` or `GET /api/settings` fails, THEN THE Home page SHALL show an error message with a Retry button that repeats the failed request in place of the Profile and hero content, and SHALL keep the "View Projects" and "Contact Me" buttons visible.

### Requirement 23: About Page

**User Story:** As a recruiter, I want to read the developer's background and goals, so that I can judge fit for my team.

#### Acceptance Criteria

1. WHEN the About page loads, THE Public_Site SHALL show the Profile's personal introduction, biography, career interests and professional goals returned by `GET /api/profile` as four separate sections, in that order, each with its own heading.
2. WHEN the About page loads, THE Public_Site SHALL show an educational background section after the Profile sections, listing the qualification and institution of every Education_Record returned by `GET /api/education`, in the order returned by the API_Server.
3. IF a Profile personal introduction, biography, career interests or professional goals value is empty or contains only whitespace, or `GET /api/education` returns zero Education_Records, THEN THE About page SHALL omit the matching section, including its heading.
4. THE About page SHALL render Profile text and Education_Record values as plain text, keeping the line breaks stored in the value and showing any HTML markup as literal characters instead of interpreting it.
5. IF `GET /api/profile` and `GET /api/education` both succeed and all five sections are omitted under criterion 3, THEN THE About page SHALL show an empty-state message.
6. IF exactly one of the `GET /api/profile` or `GET /api/education` requests fails, THEN THE About page SHALL show the sections loaded from the successful request, and SHALL show the error message with a Retry button defined in Requirement 32 only in place of the sections that depend on the failed request.

### Requirement 24: Skills Page

**User Story:** As a recruiter, I want skills grouped by category, so that I can quickly check for the technologies I need.

#### Acceptance Criteria

1. WHEN the Skills page loads and `GET /api/skills` returns a Success_Response with one or more Skills, THE Public_Site SHALL show one heading per distinct category, with heading text equal to the category value, and list each Skill name exactly once under its category heading. Category headings SHALL follow the order in which each category first appears in the response, and Skills within a category SHALL follow the order returned by the API_Server, with no re-sorting by the Frontend.
2. WHERE a Skill has a Proficiency_Level, THE Skills page SHALL show that Proficiency_Level value (`Beginner`, `Intermediate`, `Advanced` or `Expert`) as visible text next to the Skill name, and SHALL show no proficiency text for a Skill whose proficiency level is empty.
3. WHERE a Skill has an icon URL, THE Skills page SHALL show the icon next to the Skill name as a decorative image with empty alternative text, so that assistive technology announces only the Skill name.
4. IF `GET /api/skills` returns a Success_Response with an empty list, THEN THE Skills page SHALL show an empty-state message stating that no skills are listed, and SHALL show no category headings.
5. IF a Skill has no icon URL or its icon image fails to load, THEN THE Skills page SHALL show a placeholder icon with empty alternative text next to the Skill name, with no broken-image indicator.
6. WHILE the `GET /api/skills` request is in progress, THE Skills page SHALL show a loading indicator and SHALL show neither category headings nor the empty-state message.
7. IF the `GET /api/skills` request fails or returns an Error_Response, THEN THE Skills page SHALL show an error message with a Retry button that repeats the request, as defined in Requirement 32, and SHALL show neither the empty-state message nor any category headings.

### Requirement 25: Projects Page

**User Story:** As a recruiter, I want to browse and filter project cards, so that I can find the projects most relevant to the role.

#### Acceptance Criteria

1. WHEN the Projects page loads, THE Public_Site SHALL request `GET /api/projects` once through the API_Client and show one project card per Published_Project returned, in the order returned by the API_Server.
2. THE Public_Site SHALL show on each project card the Project title, thumbnail image with alternative text equal to the Project title, short description, category and a "View Details" link to `/projects/<slug>` built from the Project's Slug.
3. WHERE a Project has one or more Technologies, THE Public_Site SHALL show the name of every associated Technology on the project card, and SHALL show no Technology list on cards of Projects without Technologies.
4. WHERE a Project has a non-empty GitHub URL or live demo URL, THE Public_Site SHALL show on the project card a link labeled "GitHub" or "Live Demo" for each such URL that opens in a new tab with `rel="noopener noreferrer"`, and SHALL show no link for an empty URL.
5. WHEN the Projects page has loaded at least one Published_Project, THE Public_Site SHALL show an "All" filter control first, selected by default, followed by one filter control per distinct category of the loaded Published_Projects, with categories compared case-insensitively, each control labeled with the category spelling of the first card in that category, and the controls ordered alphabetically by label compared case-insensitively.
6. WHEN the Visitor selects a filter control, THE Public_Site SHALL mark that control as selected and every other filter control as unselected, and SHALL show only the cards whose category matches the selected category case-insensitively (or all loaded cards when "All" is selected), in the order returned by the API_Server, without sending any request to the API_Server.
7. IF a Project has an empty image URL or its image fails to load, THEN THE Public_Site SHALL show a placeholder image on that project card with alternative text equal to the Project title, and SHALL keep the rest of the card content unchanged.
8. IF `GET /api/projects` succeeds and returns zero Published_Projects, THEN THE Public_Site SHALL show an empty-state message stating that no projects are available, and SHALL show no project cards and no filter controls.
9. IF the `GET /api/projects` request fails or returns an Error_Response, THEN THE Public_Site SHALL show the error message with a Retry button defined in Requirement 32, and SHALL show neither the empty-state message nor any filter controls.

### Requirement 26: Project Details Page

**User Story:** As a recruiter, I want a detailed page for each project, so that I can understand the problem, approach and outcome.

#### Acceptance Criteria

1. WHEN a Visitor opens `/projects/<slug>`, THE Frontend SHALL request `GET /api/projects/<slug>` through the API_Client and, on a Success_Response, show the title, image, full description, problem statement, objectives, challenges, solutions, the features list in the order the API_Server returns it, the Technology names, the GitHub link and the live demo link.
2. THE Project Details page SHALL render all Project text fields as plain text without interpreting HTML markup, and SHALL open the GitHub and live demo links in a new tab with `rel="noopener noreferrer"`.
3. IF the full description, problem statement, objectives, challenges or solutions of the Project is null, empty or whitespace-only, THEN THE Project Details page SHALL omit that section, including its heading. The same applies when the features list has zero items, when the Project has zero Technologies, or when the GitHub URL or live demo URL is empty.
4. IF `GET /api/projects/<slug>` returns status 404, THEN THE Project Details page SHALL show a "Project not found" message with a link to the Projects page, and SHALL show no Project sections. Status 404 also covers a Project that exists but is not a Published_Project.
5. THE Project Details page SHALL show a link to the Projects page in the loading, loaded, not-found and error states.
6. IF the Project has no image URL or the image fails to load, THEN THE Project Details page SHALL show a placeholder image whose alternative text contains the Project title.
7. WHILE the `GET /api/projects/<slug>` request is pending, THE Project Details page SHALL show a loading indicator in place of the Project sections.
8. IF the `GET /api/projects/<slug>` request fails with a status other than 404, or fails with no response from the API_Server, THEN THE Project Details page SHALL show an error message and a Retry button that repeats the request, and SHALL NOT show the "Project not found" message.

### Requirement 27: Experience Page

**User Story:** As a recruiter, I want to see the developer's work history, so that I can assess practical experience.

#### Acceptance Criteria

1. WHEN the Experience page loads and `GET /api/experiences` returns one or more Experience_Records, THE Public_Site SHALL show one entry per Experience_Record containing the job title, company name, Employment_Type, date range, description and responsibilities, in the order returned by the API_Server without re-sorting.
2. WHEN an Experience_Record has one or more responsibilities, THE Experience page SHALL show the responsibilities as a bulleted list with exactly one bullet per item, in the order stored on the Experience_Record.
3. THE Experience page SHALL format each date in the date range as a three-letter English month abbreviation (`Jan`, `Feb`, `Mar`, `Apr`, `May`, `Jun`, `Jul`, `Aug`, `Sep`, `Oct`, `Nov`, `Dec`), a space and the four-digit year (for example "Jan 2024"), taking the month and year from the `YYYY-MM` part of the stored `YYYY-MM-DD` date so that the shown month and year are the same in every visitor time zone, and SHALL separate the start and end dates with "–" (for example "Jan 2024 – Mar 2025").
4. IF an Experience_Record has no end date, THEN THE Experience page SHALL show "Present" as the end of the date range (for example "Jan 2024 – Present").
5. IF an Experience_Record has an empty responsibilities list, THEN THE Experience page SHALL omit the bulleted list for that Experience_Record and show no empty bullets or placeholder text.
6. IF an Experience_Record has no description or an empty description, THEN THE Experience page SHALL omit the description for that Experience_Record and show no placeholder text.
7. THE Experience page SHALL render the job title, company name, description and responsibilities of each Experience_Record as plain text, so that any HTML markup in those values appears as literal characters and is not interpreted.
8. IF `GET /api/experiences` succeeds and returns zero Experience_Records, THEN THE Experience page SHALL show an empty-state message in place of the list, and SHALL NOT show the empty-state message when the request fails.

### Requirement 28: Education Page

**User Story:** As a recruiter, I want to see the developer's education, so that I can confirm academic background.

#### Acceptance Criteria

1. WHEN the Education page loads, THE Public_Site SHALL request `GET /api/education` and show one entry per returned Education_Record, containing its institution, qualification, field of study, year range and description, in the order returned by the API_Server without re-sorting.
2. THE Education page SHALL show each year range as the four-digit start year, an en dash and the four-digit end year (for example "2019 – 2023").
3. IF an Education_Record has no end year, THEN THE Education page SHALL show "Present" in place of the end year (for example "2021 – Present").
4. IF an Education_Record has an empty or missing field of study or description, THEN THE Education page SHALL omit that field from the entry, showing no label or placeholder for it, and SHALL still show the institution, qualification and year range.
5. THE Education page SHALL render each description as plain text, keeping its line breaks and showing any HTML markup as literal text rather than interpreting it.
6. IF `GET /api/education` returns a Success_Response containing zero Education_Records, THEN THE Education page SHALL show an empty-state message saying that no education entries are available, and SHALL show no education entries.
7. IF the `GET /api/education` request fails, THEN THE Education page SHALL show the error message and Retry button defined in Requirement 32, and SHALL NOT show the empty-state message.

### Requirement 29: Contact Page

**User Story:** As a Visitor, I want a simple contact form with clear feedback, so that I know my message was delivered.

#### Acceptance Criteria

1. THE Contact page SHALL show a form with a name field, an email field, a subject field, a message field, a Honeypot_Field and a submit button, where each of the name, email, subject and message fields has a visible label that is programmatically associated with that field.
2. WHEN the Visitor submits the form, THE Frontend SHALL trim leading and trailing whitespace from the name, email, subject and message values and validate the trimmed values against the Validator rules in Requirement 18: name 1–100 characters, email a Valid_Email, subject 1–150 characters and message 10–5000 characters.
3. IF client-side validation fails, THEN THE Frontend SHALL show an error message next to each invalid field stating the broken rule (required, too short, too long or invalid email format), remove the error message from each field that passes, move focus to the first invalid field in the order name, email, subject, message, keep all entered values and send no request.
4. WHILE a contact submission is in progress, THE Contact page SHALL disable the submit button, show a sending indicator and send no additional request when the Visitor activates submit again.
5. WHEN the API_Server returns status 201, THE Contact page SHALL show a success message stating that the message was sent, announce it to assistive technology, clear the name, email, subject, message and Honeypot_Field values and remove all field error messages, for every 201 response, including one where the API_Server discarded a submission with a non-empty Honeypot_Field (Requirement 8, criterion 4).
6. IF the API_Server returns an Error_Response with a status other than 429, or the request ends without any response from the API_Server, THEN THE Contact page SHALL show a form-level error message announced to assistive technology, keep all entered values, and show each field error in the Error_Response `details` next to the field it names.
7. IF the API_Server returns status 429, THEN THE Contact page SHALL show a message asking the Visitor to try again later, keep all entered values and show no field error messages.
8. WHERE the Profile has an email, a GitHub URL or a LinkedIn URL, THE Contact page SHALL show the email as a `mailto:` link whose visible text is the email address, and show the GitHub and LinkedIn URLs as links that open in a new tab with `rel="noopener noreferrer"`, omitting each link whose Profile value is empty.
9. THE Contact page SHALL hide the Honeypot_Field from sight and from assistive technology, exclude it from the keyboard tab order, disable browser autofill on it, and send its value unchanged with the submission so that the API_Server applies Requirement 8, criterion 4.
10. WHEN a contact submission ends with any response from the API_Server or with a failed request, THE Contact page SHALL re-enable the submit button and hide the sending indicator.
11. IF the Profile request fails, THEN THE Contact page SHALL show the error message and Retry button defined in Requirement 32 in place of the Profile email and links, and SHALL keep the contact form visible and able to submit.

### Requirement 30: Admin Login Page and Protected Routes

**User Story:** As the Administrator, I want a login page and protected admin pages, so that no one else can reach the dashboard.

#### Acceptance Criteria

1. THE Frontend SHALL provide a login page at `/admin/login` with an email field and a masked password field, each with a visible label, and a submit button. The login page SHALL be reachable without authentication.
2. IF the email field is empty or not a Valid_Email, or the password field is empty, when the Administrator submits the login form, THEN THE login page SHALL show a field error next to each failing field and send no request to `POST /api/auth/login`.
3. WHEN `POST /api/auth/login` returns status 200, THE Frontend SHALL store the JWT in browser storage, set the Auth_Context to authenticated with the returned admin id, email and role, and navigate to the remembered requested path. If no path was remembered, or the remembered path does not start with `/admin`, or the remembered path is `/admin/login`, THE Frontend SHALL navigate to `/admin` instead.
4. IF `POST /api/auth/login` returns status 401 or 429, THEN THE login page SHALL show the message from the Error_Response, clear the password field, keep the entered email, store no JWT and leave the Auth_Context unauthenticated.
5. WHILE the Auth_Context is verifying a stored JWT through `GET /api/auth/me`, THE Frontend SHALL show a loading indicator in place of Protected_Route content and SHALL neither render Protected_Route content nor redirect to `/admin/login` until verification completes.
6. WHEN an unauthenticated user navigates to any `/admin` path other than `/admin/login`, THE Frontend SHALL redirect to `/admin/login`, remember the requested path including its query string, and render no Protected_Route content. A user is unauthenticated when no JWT is stored or when stored-JWT verification has finished without a successful response.
7. WHEN an authenticated Administrator navigates to `/admin/login`, THE Frontend SHALL redirect to `/admin`.
8. WHILE a `POST /api/auth/login` request is in progress, THE login page SHALL disable the submit button, show a loading state on it and send no more login requests until the current one returns a response or fails.
9. IF `POST /api/auth/login` returns status 400, THEN THE login page SHALL show each field error from the Error_Response `details` next to the matching field, keep the entered email and leave the Auth_Context unauthenticated.
10. IF `POST /api/auth/login` fails because of a network error, no response, or any status of 500 or above, THEN THE login page SHALL show a Notification saying that sign-in could not be completed and the Administrator should try again, keep the entered email, re-enable the submit button and leave the Auth_Context unauthenticated.

### Requirement 31: Admin Dashboard Interface

**User Story:** As the Administrator, I want a consistent dashboard with tables, forms and clear feedback, so that I can manage content quickly and without mistakes.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL show, on every `/admin` page except `/admin/login`, a sidebar with links to Overview, Projects, Skills, Experience, Education, Messages, Profile and Settings that marks the current page's link with `aria-current="page"`, and a top bar showing the authenticated Administrator's email from the Auth_Context and a Logout button.
2. WHILE the viewport width is below 1024 pixels, THE Admin_Dashboard SHALL hide the sidebar until the Administrator activates a toggle button, SHALL expose the sidebar's open or closed state on the toggle button through `aria-expanded`, and SHALL close the sidebar after the Administrator selects a sidebar link.
3. THE Admin_Dashboard SHALL show Projects, Skills, Experience_Records and Education_Records in tables with one row per record and Edit and Delete actions per row, where Edit opens an edit form pre-filled with the record's saved values, and SHALL show Contact_Messages in a table with View and Delete actions per row.
4. THE Admin_Dashboard projects table SHALL show each Project's publication status as a text label (Published or Unpublished) and a control that requests the opposite publication state through `PATCH /api/projects/:id/publish`, and SHALL change the shown status only after the API_Server returns a Success_Response.
5. WHEN the Administrator selects a Delete action, THE Admin_Dashboard SHALL open a Confirmation_Dialog that names the item by the title or name shown in its table row and offers Confirm and Cancel buttons, SHALL send the delete request only after the Administrator selects Confirm, and SHALL send no request when the dialog is closed by Cancel or the Escape key.
6. WHEN a Confirmation_Dialog opens, THE Admin_Dashboard SHALL move keyboard focus to the first focusable control inside the dialog, keep Tab and Shift+Tab focus within the dialog while it is open, close the dialog on the Escape key, and on close return focus to the Delete control that opened it, or to the table that contained the item if a successful delete removed that control.
7. WHEN the Administrator submits a create or edit form for a Project, Skill, Experience_Record or Education_Record, THE Admin_Dashboard SHALL check every field against the Validator rules for that resource (required fields, length limits, Valid_URL, Proficiency_Level and Employment_Type values) before sending a request, and SHALL send no request while any field fails, showing a field error next to each failing field.
8. THE Admin_Dashboard project form SHALL let the Administrator add, remove and reorder feature items using controls operable by keyboard alone, SHALL send feature items in the order shown, SHALL let the Administrator add and remove Technology names with suggestions from `GET /api/technologies` whose names contain the typed text (case-insensitive), and SHALL not add a Technology name that is empty, whitespace-only or a case-insensitive duplicate of a name already on the Project.
9. THE Admin_Dashboard experience form SHALL let the Administrator add, remove and reorder responsibility items using controls operable by keyboard alone, and SHALL send responsibility items in the order shown.
10. WHEN the Administrator submits the project form for a Published_Project whose Slug field differs from the saved Slug, THE Admin_Dashboard SHALL show a warning that the public URL will change with Continue and Cancel choices, SHALL send `PUT /api/projects/:id` only after the Administrator selects Continue, and SHALL keep the form open with all entered values and send no request after the Administrator selects Cancel.
11. WHEN a create, update, delete, publish or mark-read request returns a Success_Response, THE Admin_Dashboard SHALL show a success Notification naming the action and reload the affected list from the API_Server.
12. THE Admin_Dashboard SHALL announce every Notification to assistive technology through an ARIA live region, SHALL dismiss success Notifications automatically 5 seconds after they appear, and SHALL keep error Notifications visible until the Administrator dismisses them with a close button.
13. WHILE a form submission, delete request or publish request is in progress, THE Admin_Dashboard SHALL disable the submit button, Confirm button or publish control that started it, so further activations send no additional request, and SHALL re-enable that control when the request completes with success or failure.
14. WHEN a management page requests its table data, THE Admin_Dashboard SHALL show a loading indicator in place of the table rows until the request completes, an empty-state message naming the content type when the list contains zero items, and an error message with a Retry button that repeats the request when the request fails with a status other than 401.
15. IF the API_Server rejects a form submission with status 400 and an Error_Response containing field `details`, THEN THE Admin_Dashboard SHALL show each returned field error next to the matching form field, keep all entered values in the form, and keep the form open.
16. IF a create, update, delete, publish or mark-read request fails with a status other than 401, or fails to reach the API_Server, THEN THE Admin_Dashboard SHALL show an error Notification containing the Error_Response message or a message saying the server could not be reached, and SHALL leave the shown list, publication status and read status unchanged.

### Requirement 32: Frontend Data and State Handling

**User Story:** As a developer, I want consistent data loading and state patterns across pages, so that every page behaves predictably and code is not duplicated.

#### Acceptance Criteria

1. THE Frontend SHALL send every API_Server request through the API_Client, and no Frontend component outside the API_Client SHALL call `fetch` directly.
2. WHEN the API_Client sends a request, THE API_Client SHALL build the request URL by prefixing the request path with the base URL from the `VITE_API_BASE_URL` build variable.
3. WHEN the API_Client sends a request to a protected endpoint while a JWT is stored, THE API_Client SHALL attach the JWT in the `Authorization: Bearer <token>` header.
4. WHEN the API_Server returns a Success_Response, THE API_Client SHALL return the `data` payload to the caller, together with the `meta` object when the Success_Response contains one.
5. IF the API_Server returns an Error_Response, THEN THE API_Client SHALL return an error to the caller that carries the HTTP status, the `error.code`, the `error.message` and, when present, the `error.details` field errors.
6. IF a request fails because of a network failure, a response body that is not a Success_Response or Error_Response, or no response within 15 seconds, THEN THE API_Client SHALL abort the request and return an error to the caller with a generic message indicating that the server could not be reached.
7. WHILE a data request for a page or section is in progress, THE Frontend SHALL show a loading indicator in place of that page's or section's content, and SHALL remove the loading indicator when the request succeeds or fails.
8. IF a data request fails, THEN THE Frontend SHALL show, in place of the affected page's or section's content, the error message from the Error_Response (or the generic message from criterion 6) and a Retry button, except for status 401 on an Admin_Dashboard request, which Requirement 6 criterion 4 handles.
9. WHEN the Visitor or Administrator selects the Retry button, THE Frontend SHALL hide the error message, show the loading indicator and send the same request again with the same parameters, and SHALL not show the Retry button again until that request fails.
10. THE Frontend SHALL share authentication state (token, admin identity, loading status) only through the Auth_Context, implemented with React `useContext`, and no component SHALL read the stored JWT directly except the Auth_Context and the API_Client.
11. THE Frontend SHALL provide one reusable data-fetching hook that every Public_Site page uses to load its data, exposing a loading flag, the data, the error and a retry function, starting with loading true, data empty and error empty, and ending with loading false and exactly one of data or error set.
12. THE Frontend SHALL be written with React function components and hooks only, with no class components, using `useState`, `useEffect`, `useContext`, `useRef` and `useMemo` where each applies.
13. THE Frontend SHALL derive filtered and grouped lists (project category filter, skill grouping) with `useMemo` from the loaded data, recomputing them only when the loaded data or the selected filter changes, and sending no API_Server request when the filter changes.
14. WHEN a page that started a request unmounts before the request completes, THE Frontend SHALL cancel the request or ignore its response, so that the response causes no state update, loading indicator, error message or Notification.
15. WHEN the request parameters of a mounted page change (for example a new Project_Identifier on the Project Details page) before the earlier request completes, THE Frontend SHALL show only the result of the request for the latest parameters and ignore the earlier response.

### Requirement 33: Responsive Design

**User Story:** As a Visitor on any device, I want pages that fit my screen, so that I can read the portfolio on a phone, tablet or desktop.

#### Acceptance Criteria

1. THE Frontend SHALL render every Public_Site page and every Admin_Dashboard page at any viewport width from 320 to 1920 CSS pixels inclusive with the page's total scrollable width no greater than the viewport width, so that the page itself never scrolls horizontally.
2. THE Frontend SHALL apply the mobile layout at viewport widths below 768 CSS pixels, the tablet layout from 768 to 1023 CSS pixels inclusive and the desktop layout at 1024 CSS pixels and above, and these ranges SHALL be the breakpoints used by the navigation collapse in Requirement 21 and the sidebar collapse in Requirement 31.
3. THE Projects page SHALL show Published_Project cards in equal-width columns: one column below 768 CSS pixels, two columns from 768 to 1023 CSS pixels inclusive and three columns at 1024 CSS pixels and above, and a final row with fewer cards than columns SHALL keep the same card width as full rows.
4. WHILE the viewport width is below 768 CSS pixels, THE Frontend SHALL give every button, form input, select control, checkbox, menu toggle and link outside running paragraph text a clickable area of at least 44 by 44 CSS pixels.
5. WHILE the viewport width is below 768 CSS pixels, THE Admin_Dashboard SHALL let any table wider than its container scroll horizontally inside that container, keep every column (including the Edit and Delete actions of each row) reachable by that scrolling, and keep the page itself from scrolling horizontally.
6. THE Frontend SHALL display every image, including the Profile image, project images, Skill icons and the missing-image placeholder from assumption A8, at a width no greater than its containing element and with its original aspect ratio kept.
7. IF a displayed text value contains an unbroken string wider than its container, such as a Valid_URL of up to 2048 characters, a Valid_Email of up to 254 characters or a Slug of up to 160 characters, THEN THE Frontend SHALL wrap that string inside its container so that the page itself does not scroll horizontally.
8. WHEN the viewport width crosses 768 or 1024 CSS pixels because the window is resized or the device orientation changes, THE Frontend SHALL switch to the layout for the new width without reloading the page, keeping the current route and any values already typed into form fields.

### Requirement 34: Accessibility

**User Story:** As a Visitor using a keyboard or assistive technology, I want an accessible site, so that I can use every feature.

#### Acceptance Criteria

1. THE Frontend SHALL render all text on every Public_Site and Admin_Dashboard page with a contrast ratio against its background of at least 4.5:1 for normal text and at least 3:1 for large text, and SHALL render the boundaries of interface components and any icons that carry meaning with a contrast ratio of at least 3:1 against adjacent colors, per WCAG 2.1 level AA. Large text means at least 24 CSS pixels at regular weight or at least 18.66 CSS pixels bold.
2. THE Frontend SHALL make every interactive element on every Public_Site and Admin_Dashboard page reachable with the Tab and Shift+Tab keys and operable with the Enter key, or the Space key for buttons and checkboxes. The focus order SHALL follow the visual reading order from top to bottom and left to right, and keyboard focus SHALL NOT be trapped inside any element other than an open Confirmation_Dialog. Interactive elements include links, buttons, form fields, menus and dialog controls.
3. THE Frontend SHALL show a focus indicator on every focusable element while it has keyboard focus. The indicator SHALL be at least 2 CSS pixels thick, SHALL have a contrast ratio of at least 3:1 against adjacent colors, and SHALL NOT be fully hidden by other content.
4. THE Frontend SHALL associate every form field in the Public_Site and Admin_Dashboard with a visible label that stays visible while the field contains a value. While a field error message is displayed, THE Frontend SHALL connect that message to its field with `aria-describedby` and mark the field with `aria-invalid="true"`. This applies to errors found by the Frontend and to field errors returned in the `details` of an Error_Response. The Honeypot_Field is the only exception: THE Frontend SHALL hide it from assistive technologies and remove it from the keyboard focus order.
5. THE Frontend SHALL give every informative image non-empty alternative text that names its subject. The Profile image and its placeholder SHALL use the Profile name, and a Project image and its placeholder SHALL use the Project title. Decorative images, Skill icons shown next to the Skill name text and the Skill icon placeholder SHALL have empty alternative text (`alt=""`).
6. THE Frontend SHALL give every page exactly one `main` landmark and exactly one `h1`, with heading levels that never skip a level. Every Public_Site page SHALL also have exactly one `header`, at least one `nav` and exactly one `footer` landmark, and every Admin_Dashboard page other than `/admin/login` SHALL have at least one `nav` landmark. WHERE a page contains more than one `nav` landmark, each `nav` landmark SHALL have a distinct accessible name.
7. THE Frontend SHALL provide a "Skip to main content" link as the first focusable element on every page. The link SHALL become visible when it receives keyboard focus. Activating the link SHALL move focus to the `main` landmark, so the next Tab press reaches the first focusable element inside `main`.
8. WHERE the user's system requests reduced motion (`prefers-reduced-motion: reduce`), THE Frontend SHALL disable hover and entrance animations, including transitions that move, scale or fade elements, and SHALL show each affected element in its final state immediately.
9. WHEN the Frontend navigates to a different route without a full page reload, THE Frontend SHALL update the document title so it contains the name of the new page, and SHALL move keyboard focus to the new page's `main` landmark or `h1`.
10. WHEN a Confirmation_Dialog opens, THE Frontend SHALL expose it to assistive technologies as a modal dialog whose accessible name is the dialog title, SHALL move keyboard focus into the dialog, and SHALL keep Tab and Shift+Tab focus cycling within the dialog. Pressing Escape SHALL close the dialog as a cancellation without performing the destructive action. When the dialog closes for any reason, focus SHALL return to the element that opened it.
11. WHEN the Frontend shows a Notification, THE Frontend SHALL announce the Notification text to assistive technologies through a live region without moving keyboard focus.

### Requirement 35: Performance

**User Story:** As a Visitor, I want pages to load fast, so that I keep browsing instead of leaving.

#### Acceptance Criteria

1. THE API_Server SHALL respond to each GET endpoint that requires no JWT within 300 milliseconds at the 95th percentile, measured at the API_Server from receipt of the request to sending the complete response, over a sample of at least 1,000 requests with up to 10 concurrent requests and up to 200 rows in each Database table, excluding network latency between the client and the API_Server.
2. WHEN a Visitor loads any Public_Site page without navigating to a path under `/admin`, THE Frontend SHALL request no JavaScript bundle that contains Admin_Dashboard code.
3. WHEN a Visitor navigates to a path under `/admin`, THE Frontend SHALL download the Admin_Dashboard bundles needed for that path at that moment, before rendering the Admin_Dashboard page or the login page.
4. THE Frontend SHALL keep the total gzipped size of all JavaScript files requested before the first Public_Site page renders at 250 KB or less, measured on the production build.
5. WHEN a Public_Site page loads, THE Frontend SHALL not request any project card image or Skill icon positioned entirely outside the viewport at initial render until the Visitor scrolls that image into the viewport.
6. IF a lazy-loaded project card image or Skill icon fails to load, THEN THE Frontend SHALL show the placeholder image in its place.
7. THE API_Server SHALL reuse Database connections through a connection pool whose maximum size is read from the `DB_POOL_MAX` environment variable, accepting an integer from 1 to 100 and using 10 when `DB_POOL_MAX` is unset.
8. IF `DB_POOL_MAX` is set to a value that is not an integer from 1 to 100, THEN THE API_Server SHALL stop at startup with an error message naming `DB_POOL_MAX`, before accepting any request.
9. IF a request waits more than 5 seconds for a free Database connection, THEN THE API_Server SHALL stop processing that request, return status 503 with an Error_Response indicating the service is temporarily unavailable, and leave the Database unchanged by that request.
10. WHEN the API_Server returns a Project list from `GET /api/projects` or `GET /api/admin/projects`, THE API_Server SHALL fetch the Projects and their Technologies using the same number of Database queries whether the list contains 0, 1 or 200 Projects.

### Requirement 36: Configuration and Deployment

**User Story:** As the portfolio owner, I want to deploy the frontend, backend and database with configuration only, so that I can host the portfolio publicly.

#### Acceptance Criteria

1. WHEN the Frontend build npm script runs, THE Frontend SHALL produce static production assets (HTML, JavaScript and CSS) with the Vite build command and exit with status code 0, and the produced assets SHALL be servable by a static file host without a running Node.js process.
2. WHEN the Frontend is built with `VITE_API_BASE_URL` set, THE API_Client SHALL use that value as the base URL for every request to the API_Server, and the built assets SHALL contain no `localhost` or `127.0.0.1` URL unless that value itself is the configured `VITE_API_BASE_URL`.
3. IF `VITE_API_BASE_URL` is unset or empty when the Frontend production build runs, THEN THE Frontend build SHALL stop with an error message naming `VITE_API_BASE_URL` and exit with a non-zero status code without producing production assets.
4. THE API_Server SHALL connect to the Database using either `DATABASE_URL` or the individual `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` variables, with `DATABASE_URL` taking precedence and the individual variables ignored when both are set, and with `PGPORT` defaulting to 5432 when unset.
5. IF `DATABASE_URL` is unset and any of `PGHOST`, `PGUSER` or `PGDATABASE` is unset when the API_Server starts, THEN THE API_Server SHALL log a configuration error naming the missing variables, SHALL not listen on its port and SHALL exit with a non-zero status code.
6. WHERE the Database SSL setting is enabled, THE API_Server SHALL open every Database connection over SSL and SHALL NOT fall back to an unencrypted connection when the SSL connection attempt fails.
7. IF the API_Server cannot connect to the Database, or the Database does not answer a test query within 10 seconds, at startup, THEN THE API_Server SHALL log the connection failure with a message that excludes the Database password and the full `DATABASE_URL` value, SHALL not listen on its port and SHALL exit with a non-zero status code.
8. WHEN the API_Server receives `GET /api/health` and the Database answers a test query within 5 seconds, THE API_Server SHALL return status 200 with a Success_Response, without requiring a JWT.
9. IF the Database fails the `GET /api/health` test query or does not answer it within 5 seconds, THEN THE API_Server SHALL return status 503 with an Error_Response that excludes Database connection details, credentials and Database error text, and SHALL continue serving other requests.
10. THE Portfolio_System SHALL provide npm scripts that start the Frontend dev server, start the API_Server in development mode, start the API_Server in production mode with `NODE_ENV` set to `production`, run the Migration_Runner, run the Seed_Script, build the Frontend, and run the Frontend and API_Server tests in a single non-watch run that exits with status code 0 when all tests pass and a non-zero status code otherwise.

### Requirement 37: Documentation

**User Story:** As a reviewer or future maintainer, I want setup and deployment documentation, so that I can run the project without asking the author.

#### Acceptance Criteria

1. THE Portfolio_System SHALL include a `README.md` file at the repository root that contains, under separate headings, a project description naming the Public_Site and the Admin_Dashboard, the technology stack of each layer as stated in the Introduction (React, Vite, React Router DOM and plain CSS for the Frontend; Node.js and Express for the API_Server; PostgreSQL accessed through `pg` for the Database; bcrypt and JWT for authentication), and the directory structure of `client/` and `server/` with a one-line purpose for each top-level directory.
2. THE root `README.md` SHALL summarize each assumption A1 to A12 and each technical risk R1 to R6 recorded in this document, with each summary labeled by its identifier.
3. THE root `README.md` SHALL list the prerequisite software (Node.js, npm and PostgreSQL) with the minimum supported version of each, and SHALL give the installation steps for a fresh clone as a numbered list of commands in execution order, stating the directory each command runs from.
4. THE root `README.md` SHALL document every environment variable read by the API_Server, the Migration_Runner, the Seed_Script or the Frontend, stating for each one the `.env.example` file it belongs to (`server/.env.example` or `client/.env.example`), its purpose, whether it is required or optional, its default value when one exists (including the 2-hour default of `JWT_EXPIRES_IN` and the default of 10 for `DB_POOL_MAX`), and its constraints (including the 32-character minimum of `JWT_SECRET`, the 12-character minimum and 72-byte maximum of `ADMIN_PASSWORD`, and the precedence of `DATABASE_URL` over `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` when both forms are set).
5. THE set of environment variables documented in the root `README.md` SHALL be identical to the combined set of variables in `server/.env.example` and `client/.env.example`, with no variable present in one and absent from the other.
6. THE root `README.md` SHALL document the commands to create the Database, run the Migration_Runner and run the Seed_Script, including the `ADMIN_EMAIL` and `ADMIN_PASSWORD` variables the Seed_Script requires, how to enable the sample-content option, and the fact that re-running the Seed_Script leaves an existing admin account unchanged.
7. THE root `README.md` SHALL document each npm script the Portfolio_System provides (Frontend dev server, API_Server development start, API_Server production start, migrations, Seed_Script, Frontend build and tests) with its exact command and the directory it runs from.
8. THE root `README.md` SHALL document production deployment steps for the Frontend, the API_Server and a hosted PostgreSQL Database, covering: building the Frontend with `VITE_API_BASE_URL` set to the production API_Server URL; setting `FRONTEND_URL` to the exact production Frontend origin; setting `NODE_ENV`, `TRUST_PROXY` and the Database SSL setting; running the Migration_Runner and the Seed_Script against the hosted Database; running the API_Server as a single instance because Rate_Limiter counters are held in memory; and confirming the deployment by a `GET /api/health` request that returns status 200.
9. THE root `README.md` SHALL list every endpoint the API_Server exposes under `/api`, including `GET /api/health` and the `/api/admin/` endpoints, exactly once, with its HTTP method, full path, authentication requirement stated as either "public" or "Administrator JWT required", and a one-sentence purpose. For the login and contact submission endpoints, the entry SHALL also state the Rate_Limiter limit defined in A9.
10. THE root `README.md` SHALL list no endpoint that the API_Server does not expose.
11. THE root `README.md` SHALL use only placeholder values for secrets and credentials. It SHALL contain no real `JWT_SECRET` value, no real password, no `DATABASE_URL` that contains real credentials, and no admin email of a deployed instance.
12. WHEN a person who has the documented prerequisite software follows the root `README.md` installation, Database creation, migration, seeding and development steps in order on a fresh clone, THE Portfolio_System SHALL start the Frontend and the API_Server, return status 200 from `GET /api/health`, and accept an Administrator login with the seeded `ADMIN_EMAIL` and `ADMIN_PASSWORD`, with no step needed that the README does not include.

### Requirement 38: Automated Testing

**User Story:** As a developer, I want automated tests for critical behavior, so that I can change code with confidence.

#### Acceptance Criteria

1. THE Portfolio_System SHALL include API_Server tests for `POST /api/auth/login` confirming: status 200 with a Success_Response containing a JWT and the admin's id, email and role for matching credentials; status 401 for an unknown email; status 401 for a wrong password; and status 400 for a missing email, a missing password or an email that is not a Valid_Email.
2. THE Portfolio_System SHALL include API_Server tests confirming that protected endpoints return status 401 with an Error_Response for a request without an `Authorization: Bearer` header, a JWT with an invalid signature, a malformed JWT, a JWT with a past expiry time and a JWT whose admin id no longer exists in the Database, and that the Role_Guard returns status 403 with an Error_Response for a valid JWT carrying a role other than `admin`.
3. THE Portfolio_System SHALL include API_Server tests confirming, for Projects, Skills, Experience_Records and Education_Records, that create returns status 201 with the created record, read returns the record, update returns status 200 with the updated record, delete returns status 200, and a read after delete returns status 404; and confirming read and update for Profile and Settings, and list, read by id, mark as read and delete for Contact_Messages.
4. THE Portfolio_System SHALL include API_Server tests confirming that, for each resource in criterion 3, an invalid request body returns status 400 with an Error_Response whose `details` names each invalid field and leaves the Database unchanged, a non-existent id returns status 404, an id that is not a positive integer returns status 400, and a duplicate Slug returns status 409.
5. THE Portfolio_System SHALL include API_Server tests confirming that a valid `POST /api/contact` request stores exactly one Contact_Message and returns status 201, an invalid request stores nothing and returns status 400, and a request with a non-empty Honeypot_Field returns status 201 and stores nothing.
6. THE Portfolio_System SHALL include API_Server tests confirming that the Rate_Limiter returns status 429 with a `Retry-After` header for the 6th failed `POST /api/auth/login` attempt from one client IP address within 15 minutes and for the 6th `POST /api/contact` submission from one client IP address within 60 minutes.
7. THE Portfolio_System SHALL include integration tests confirming that an unpublished Project is absent from `GET /api/projects`, returns status 404 from `GET /api/projects/:identifier` by both id and Slug with and without a JWT, and is present in `GET /api/admin/projects` and `GET /api/admin/projects/:id`; and that after `PATCH /api/projects/:id/publish` publishes the Project it appears on both public endpoints, and after unpublishing it is absent again.
8. THE Portfolio_System SHALL include API_Server tests confirming that a simulated Database error returns status 500 with an Error_Response containing a generic message, and that with `NODE_ENV` set to `production` the Error_Response contains no stack trace, SQL text or internal error message.
9. THE Portfolio_System SHALL include property-based tests, each running at least 100 generated inputs, for: the Slug_Generator output matching the Slug format for every title, and the Slug_Generator idempotence property in Requirement 13; acceptance of in-bound values and rejection of out-of-bound values by the Validator rules; and the round-trip properties stated in Requirements 10, 11, 13 and 16. IF a property-based test fails, THEN THE test run SHALL report the failing generated input.
10. THE Portfolio_System SHALL include Frontend tests, run without a running API_Server or Database, covering: rendering of the Home, About, Skills, Projects, Project Details, Experience, Education and Contact pages from mocked API_Client responses; navigation between those pages; contact form validation showing field errors and sending no request for invalid input; Protected_Route redirection of an unauthenticated user to `/admin/login`; redirection of an authenticated Administrator from `/admin/login` to `/admin`; and the loading state and error state of a page whose request is pending or fails.
11. THE Portfolio_System SHALL run API_Server tests against a Database separate from the development and production Databases, configured through an environment variable, and SHALL reset that Database to a known state before each test file, so that test results do not depend on the order in which tests run.
12. THE Portfolio_System SHALL run all API_Server and Frontend tests through single-run npm scripts that need no user input, exit with status 0 when every test passes and exit with a non-zero status when any test fails.
