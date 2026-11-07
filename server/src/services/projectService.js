// Projects (Requirements 9.1, 12.1–12.5, 12.8, 12.9, 13.1–13.6, 13.16–13.18, 14.4, 14.5, 14.7,
// 35.10).
//
// All SQL for the projects table lives here. Every statement is parameterized; values such as the
// category filter, an id or a Slug are always bind parameters, never part of the SQL text (9.1).
//
// Every read goes through `selectProjects(where)`: one statement that returns the project columns
// plus its Technologies aggregated with json_agg. A list therefore costs exactly one query whether
// it holds 0, 1 or 200 Projects (35.10). Rows are turned into response objects by
// `toPublicProject` (no `is_published`) or `toAdminProject` (with `is_published`).
//
// Writes: `create` and `update` run as one transaction (14.4, 14.5) that takes the Slug advisory
// lock, checks existence (update) before Slug uniqueness (4.12), writes the row, makes sure every
// Technology exists and replaces the Project's associations. Any throw rolls everything back.
import { ensureTechnologiesByNames } from './technologyService.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import { generateUniqueSlug } from '../utils/slug.js';

/** Project columns selected by every read, in response order. */
export const PROJECT_COLUMNS = Object.freeze([
  'id',
  'title',
  'slug',
  'short_description',
  'full_description',
  'problem_statement',
  'objectives',
  'challenges',
  'solutions',
  'category',
  'image_url',
  'github_url',
  'live_demo_url',
  'display_order',
  'features',
  'is_published',
  'created_at',
  'updated_at',
]);

/** Keys of a PublicProject (design: API Data Shapes). `is_published` is admin-only. */
export const PUBLIC_PROJECT_KEYS = Object.freeze([
  ...PROJECT_COLUMNS.filter((c) => c !== 'is_published'),
  'technologies',
]);

/** Keys of an AdminProject: PublicProject + `is_published`. */
export const ADMIN_PROJECT_KEYS = Object.freeze([...PUBLIC_PROJECT_KEYS, 'is_published']);

/** Documented project order (design "Sorting"): display_order, newest first, then id. */
export const PROJECT_ORDER = 'p.display_order ASC, p.created_at DESC, p.id DESC';

/**
 * Builds the single aggregated read. `where` is a fixed SQL fragment chosen in this module (never
 * from input); values reach it only through `$n` placeholders. Technologies are ordered by name
 * case-insensitively in code-point order, then id, matching GET /api/technologies.
 * @param {string} where
 */
export function selectProjects(where) {
  return `SELECT ${PROJECT_COLUMNS.map((c) => `p.${c}`).join(', ')},
       COALESCE(
         json_agg(json_build_object('id', t.id, 'name', t.name, 'category', t.category)
                  ORDER BY lower(t.name) COLLATE "C", t.id)
           FILTER (WHERE t.id IS NOT NULL),
         '[]'::json) AS technologies
  FROM projects p
  LEFT JOIN project_technologies pt ON pt.project_id = p.id
  LEFT JOIN technologies t ON t.id = pt.technology_id
 WHERE ${where}
 GROUP BY p.id
 ORDER BY ${PROJECT_ORDER}`;
}

/**
 * Columns written by create and update, in bind-parameter order. A fixed allow-list: column names
 * never come from the request (9.1). `features` is bound as `text[]`.
 */
export const WRITE_COLUMNS = Object.freeze([
  'title',
  'slug',
  'short_description',
  'full_description',
  'problem_statement',
  'objectives',
  'challenges',
  'solutions',
  'category',
  'image_url',
  'github_url',
  'live_demo_url',
  'display_order',
  'features',
  'is_published',
]);

const CASTS = Object.freeze({ features: '::text[]' });
const placeholder = (column, n) => `$${n}${CASTS[column] ?? ''}`;

export const SQL = Object.freeze({
  // 12.1, 12.2, 12.9: $1 is the category or NULL for no filter; compared case-insensitively.
  listPublic: selectProjects('p.is_published AND ($1::text IS NULL OR lower(p.category) = lower($1::text))'),
  // 12.3, 12.5: an unpublished Project gives no row, exactly like a missing one.
  getPublicById: selectProjects('p.is_published AND p.id = $1'),
  // 12.4: exact, case-sensitive Slug match.
  getPublicBySlug: selectProjects('p.is_published AND p.slug = $1'),
  // 13.1, 13.2: every Project, published or not.
  listAdmin: selectProjects('TRUE'),
  getAdmin: selectProjects('p.id = $1'),

  // Save transaction (design: Slug_Generator, project save). The transaction-level advisory lock
  // serializes every Slug decision, so the set of taken Slugs read below stays accurate until
  // COMMIT. It is released automatically at COMMIT or ROLLBACK.
  lockSlugs: "SELECT pg_advisory_xact_lock(hashtext('projects_slug'))",
  // Existence check for update, before any uniqueness check (4.12, 13.17).
  lockProject: 'SELECT id, slug, is_published FROM projects WHERE id = $1 FOR UPDATE',
  slugOwner: 'SELECT id FROM projects WHERE slug = $1',
  takenSlugs: 'SELECT slug FROM projects',
  insert: `INSERT INTO projects (${WRITE_COLUMNS.join(', ')})
           VALUES (${WRITE_COLUMNS.map((c, i) => placeholder(c, i + 1)).join(', ')})
           RETURNING id`,
  update: `UPDATE projects
              SET ${WRITE_COLUMNS.map((c, i) => `${c} = ${placeholder(c, i + 2)}`).join(', ')}
            WHERE id = $1`,
  // 13.4, 14.7: associations are replaced with exactly the submitted Technologies.
  deleteLinks: 'DELETE FROM project_technologies WHERE project_id = $1',
  insertLinks: `INSERT INTO project_technologies (project_id, technology_id)
                SELECT $1, unnest($2::int[])`,

  // 13.5: only the flag changes.
  setPublished: 'UPDATE projects SET is_published = $2 WHERE id = $1 RETURNING id',
  // 13.6: project_technologies rows go with ON DELETE CASCADE; Technologies are kept.
  remove: 'DELETE FROM projects WHERE id = $1 RETURNING id',
});

const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));

/** @param {object} row a row from `selectProjects` @returns {object} a PublicProject */
export const toPublicProject = (row) => pick(row, PUBLIC_PROJECT_KEYS);

/** @param {object} row a row from `selectProjects` @returns {object} an AdminProject */
export const toAdminProject = (row) => pick(row, ADMIN_PROJECT_KEYS);

/**
 * @typedef {{ title: string, slug?: string, short_description: string, full_description: string,
 *   problem_statement: string, objectives: string, challenges: string, solutions: string,
 *   category: string, image_url: string, github_url: string, live_demo_url: string,
 *   display_order: number, is_published?: boolean, features: string[], technologies: string[] }} ProjectInput
 *   The normalized `projectBody`: trimmed, omitted text/URL fields '', lists [], and `slug` /
 *   `is_published` undefined when not supplied.
 * @typedef {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} Queryable
 */

/** Bind values for WRITE_COLUMNS. */
const writeValues = (input, slug, isPublished) =>
  WRITE_COLUMNS.map((c) => {
    if (c === 'slug') return slug;
    if (c === 'is_published') return isPublished;
    return input[c];
  });

/**
 * 13.18: a supplied Slug that belongs to another Project is a conflict. `ownId` is the Project
 * being updated (its own Slug is not a conflict), or null on create.
 * @param {Queryable} tx
 */
async function assertSlugFree(tx, slug, ownId) {
  const { rows } = await tx.query(SQL.slugOwner, [slug]);
  if (rows.some((r) => r.id !== ownId)) throw new ConflictError('slug');
}

/** Replaces the Project's Technology associations (13.4, 14.1, 14.2, 14.7). @param {Queryable} tx */
async function replaceTechnologies(tx, projectId, names) {
  const ids = await ensureTechnologiesByNames(tx, names);
  await tx.query(SQL.deleteLinks, [projectId]);
  if (ids.length > 0) await tx.query(SQL.insertLinks, [projectId, ids]);
}

/** @param {Queryable} q @returns {Promise<object | null>} the AdminProject or null */
async function readAdmin(q, id) {
  const { rows } = await q.query(SQL.getAdmin, [id]);
  return rows[0] ? toAdminProject(rows[0]) : null;
}

/** @param {{ db: { query: Function, withTransaction?: Function } }} deps */
export function createProjectService({ db }) {
  async function one(sql, params) {
    const { rows } = await db.query(sql, params);
    return rows[0] ? toPublicProject(rows[0]) : null;
  }

  /** Runs `work(tx)` in one transaction; `db.withTransaction` rolls back on any throw (14.5). */
  const inTransaction = (work) => db.withTransaction(work);

  return Object.freeze({
    /**
     * Published Projects in the documented order, optionally filtered by category.
     * @param {{ category?: string }} [filter] `category` already trimmed by publicProjectQuery
     * @returns {Promise<object[]>} [] when no Published_Project matches (12.9)
     */
    async listPublic({ category } = {}) {
      const { rows } = await db.query(SQL.listPublic, [category ?? null]);
      return rows.map(toPublicProject);
    },

    /** @param {number} id @returns {Promise<object | null>} null when missing or unpublished */
    getPublicById(id) {
      return one(SQL.getPublicById, [id]);
    },

    /** @param {string} slug @returns {Promise<object | null>} null when missing or unpublished */
    getPublicBySlug(slug) {
      return one(SQL.getPublicBySlug, [slug]);
    },

    /** @returns {Promise<object[]>} every AdminProject in the documented order; [] when none (13.1) */
    async listAdmin() {
      const { rows } = await db.query(SQL.listAdmin);
      return rows.map(toAdminProject);
    },

    /** @param {number} id @returns {Promise<object | null>} null when no Project has this id (13.2) */
    getAdmin(id) {
      return readAdmin(db, id);
    },

    /**
     * 13.3, 13.10–13.12, 13.16, 13.18, 14.4: creates the Project, unpublished unless
     * `is_published` is supplied, with the supplied Slug or one generated from the title.
     * @param {ProjectInput} input
     * @returns {Promise<object>} the created AdminProject
     * @throws {ConflictError} the supplied Slug belongs to another Project
     */
    create(input) {
      return inTransaction(async (tx) => {
        await tx.query(SQL.lockSlugs);
        let slug = input.slug;
        if (slug) {
          await assertSlugFree(tx, slug, null);
        } else {
          const { rows } = await tx.query(SQL.takenSlugs);
          slug = generateUniqueSlug(input.title, new Set(rows.map((r) => r.slug)));
        }
        const { rows } = await tx.query(SQL.insert, writeValues(input, slug, input.is_published ?? false));
        const id = rows[0].id;
        await replaceTechnologies(tx, id, input.technologies);
        return readAdmin(tx, id);
      });
    },

    /**
     * 13.4, 13.16–13.18, 14.4, 14.7: replaces every field, the features list and the Technology
     * associations. An omitted `is_published` and an omitted or empty Slug keep the stored value.
     * @param {number} id @param {ProjectInput} input
     * @returns {Promise<object>} the updated AdminProject
     * @throws {NotFoundError} no Project has this id (checked before the Slug)
     * @throws {ConflictError} the supplied Slug belongs to another Project
     */
    update(id, input) {
      return inTransaction(async (tx) => {
        await tx.query(SQL.lockSlugs);
        const { rows } = await tx.query(SQL.lockProject, [id]);
        const current = rows[0];
        if (!current) throw new NotFoundError('Project');
        const slug = input.slug || current.slug;
        if (slug !== current.slug) await assertSlugFree(tx, slug, id);
        const isPublished = input.is_published ?? current.is_published;
        await tx.query(SQL.update, [id, ...writeValues(input, slug, isPublished)]);
        await replaceTechnologies(tx, id, input.technologies);
        return readAdmin(tx, id);
      });
    },

    /**
     * 13.5: sets only `is_published`, also when it already has that value.
     * @param {number} id @param {boolean} value
     * @returns {Promise<object | null>} the updated AdminProject, or null when no Project has this id
     */
    async setPublished(id, value) {
      const { rows } = await db.query(SQL.setPublished, [id, value]);
      if (rows.length === 0) return null;
      return readAdmin(db, id);
    },

    /** 13.6 @param {number} id @returns {Promise<boolean>} false when no Project has this id */
    async remove(id) {
      const { rows } = await db.query(SQL.remove, [id]);
      return rows.length > 0;
    },
  });
}
