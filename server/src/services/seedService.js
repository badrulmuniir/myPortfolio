// Seed_Script logic (Requirements 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8).
//
// Every write runs in one transaction, so a failure in any step rolls back the whole run (3.7).
// Steps run in order: admin, profile, settings, sample. `step` names the current step for the
// error message; a failure before the first step (no connection) is reported as `connect`, and a
// failed COMMIT as `commit`.
//
// The admin password is used only as the input to `hasher.hash`. It is never logged, and every
// error message is built from the step name and a sanitized reason with the password removed (3.8).
import { sampleContent as defaultSampleContent } from '../../seed/sampleContent.js';
import { describeDbError, sanitizeMessage } from '../db/connectionInfo.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { hasher as defaultHasher } from '../utils/password.js';

export const SEED_STEPS = Object.freeze(['admin', 'profile', 'settings', 'sample']);

/** Key for pg_advisory_xact_lock, so two concurrent seed runs cannot both create an admin. */
export const SEED_LOCK_KEY = '7230512027';

/** Default Settings values created when a key is missing (3.4). */
export const DEFAULT_SETTINGS = Object.freeze({
  site_title: 'My Portfolio',
  hero_introduction: '',
  footer_text: '',
  social_links: Object.freeze([]),
});

/** Placeholder Profile values; the Administrator edits them after the first login. */
export const DEFAULT_PROFILE = Object.freeze({ name: 'Your Name', professional_title: 'Software Developer' });

export const SQL = Object.freeze({
  lock: 'SELECT pg_advisory_xact_lock($1::bigint)',
  anyAdmin: 'SELECT 1 FROM admins LIMIT 1',
  insertAdmin: "INSERT INTO admins (email, password_hash, role) VALUES ($1, $2, 'admin')",
  insertProfile:
    'INSERT INTO profile (id, name, professional_title, email) VALUES (1, $1, $2, $3) ' +
    'ON CONFLICT (id) DO NOTHING RETURNING id',
  insertSettings:
    'INSERT INTO settings (setting_key, setting_value) ' +
    'SELECT k, v::jsonb FROM unnest($1::text[], $2::text[]) AS s(k, v) ' +
    'ON CONFLICT (setting_key) DO NOTHING RETURNING setting_key',
  contentExists:
    'SELECT EXISTS (SELECT 1 FROM projects) OR EXISTS (SELECT 1 FROM skills) ' +
    'OR EXISTS (SELECT 1 FROM experiences) OR EXISTS (SELECT 1 FROM education) AS has_content',
  insertProject:
    'INSERT INTO projects (title, slug, short_description, full_description, problem_statement, ' +
    'objectives, challenges, solutions, category, image_url, github_url, live_demo_url, features, ' +
    'is_published, display_order) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text[], $14, $15) RETURNING id',
  insertTechnologies:
    'INSERT INTO technologies (name) SELECT unnest($1::text[]) ON CONFLICT ((lower(name))) DO NOTHING',
  selectTechnologyIds: 'SELECT id FROM technologies WHERE lower(name) = ANY ($1::text[]) ORDER BY id',
  linkTechnologies:
    'INSERT INTO project_technologies (project_id, technology_id) ' +
    'SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING',
  insertSkill:
    'INSERT INTO skills (name, category, proficiency_level, icon_url, display_order) VALUES ($1, $2, $3, $4, $5)',
  insertExperience:
    'INSERT INTO experiences (job_title, company_name, employment_type, start_date, end_date, description, ' +
    'responsibilities) VALUES ($1, $2, $3, $4, $5, $6, $7::text[])',
  insertEducation:
    'INSERT INTO education (institution, qualification, field_of_study, start_year, end_year, description) ' +
    'VALUES ($1, $2, $3, $4, $5, $6)',
});

/** A seed run failed. Every write of the run was rolled back. The message never holds the password. */
export class SeedError extends Error {
  /** @param {{ step: string, reason: string }} options */
  constructor({ step, reason }) {
    super(`Seed step "${step}" failed: ${reason}`);
    this.name = 'SeedError';
    this.step = step;
    this.reason = reason;
  }
}

/**
 * Runs the seed.
 * @param {{
 *   db: { withTransaction: (work: (tx: { query: Function }) => Promise<unknown>) => Promise<unknown>,
 *     describeError?: (err: unknown) => string },
 *   config: { adminEmail: string, adminPassword: string, sampleContent: boolean },
 *   hasher?: { hash: (password: string) => Promise<string> },
 *   logger?: object,
 *   sampleContent?: typeof defaultSampleContent,
 * }} options
 * @returns {Promise<{ admin: 'created' | 'exists', profile: 'created' | 'exists',
 *   settingsCreated: string[], sample: 'disabled' | 'inserted' | 'skipped' }>}
 * @throws {SeedError}
 */
export async function runSeed({
  db,
  config,
  hasher = defaultHasher,
  logger = defaultLogger,
  sampleContent = defaultSampleContent,
}) {
  let step = 'connect';
  const summary = {};

  try {
    await db.withTransaction(async (tx) => {
      step = 'admin';
      summary.admin = await seedAdmin(tx, config, hasher, logger);
      step = 'profile';
      summary.profile = await seedProfile(tx, config, logger);
      step = 'settings';
      summary.settingsCreated = await seedSettings(tx, logger);
      step = 'sample';
      summary.sample = await seedSample(tx, config, sampleContent, logger);
      step = 'commit';
    });
  } catch (err) {
    const describe = db.describeError ?? describeDbError;
    const secrets = config?.adminPassword ? [config.adminPassword] : [];
    // describeError removes Database secrets; the second pass removes the admin password.
    throw new SeedError({ step, reason: sanitizeMessage(describe(err), secrets) });
  }

  logger.info('Seed completed');
  return Object.freeze(summary);
}

async function seedAdmin(tx, config, hasher, logger) {
  await tx.query(SQL.lock, [SEED_LOCK_KEY]);
  const { rows } = await tx.query(SQL.anyAdmin);
  if (rows.length > 0) {
    logger.info('Admin account already exists; no admin account created');
    return 'exists';
  }
  const passwordHash = await hasher.hash(config.adminPassword);
  await tx.query(SQL.insertAdmin, [config.adminEmail, passwordHash]);
  logger.info('Admin account created', { email: config.adminEmail });
  return 'created';
}

async function seedProfile(tx, config, logger) {
  const { rows } = await tx.query(SQL.insertProfile, [
    DEFAULT_PROFILE.name,
    DEFAULT_PROFILE.professional_title,
    config.adminEmail,
  ]);
  const created = rows.length > 0;
  logger.info(created ? 'Profile created' : 'Profile already exists; left unchanged');
  return created ? 'created' : 'exists';
}

async function seedSettings(tx, logger) {
  const keys = Object.keys(DEFAULT_SETTINGS);
  const values = keys.map((k) => JSON.stringify(DEFAULT_SETTINGS[k]));
  const { rows } = await tx.query(SQL.insertSettings, [keys, values]);
  const created = rows.map((r) => r.setting_key);
  logger.info(
    created.length > 0 ? `Settings created: ${created.join(', ')}` : 'All settings already exist; left unchanged',
  );
  return created;
}

async function seedSample(tx, config, content, logger) {
  if (!config.sampleContent) return 'disabled';

  const { rows } = await tx.query(SQL.contentExists);
  if (rows[0]?.has_content) {
    logger.info('Sample content skipped: the database already contains content');
    return 'skipped';
  }

  for (const p of content.projects) {
    const { rows: inserted } = await tx.query(SQL.insertProject, [
      p.title,
      p.slug,
      p.short_description,
      p.full_description ?? '',
      p.problem_statement ?? '',
      p.objectives ?? '',
      p.challenges ?? '',
      p.solutions ?? '',
      p.category,
      p.image_url ?? '',
      p.github_url ?? '',
      p.live_demo_url ?? '',
      p.features ?? [],
      p.is_published ?? false,
      p.display_order,
    ]);
    const names = p.technologies ?? [];
    if (names.length > 0) {
      await tx.query(SQL.insertTechnologies, [names]);
      const { rows: techs } = await tx.query(SQL.selectTechnologyIds, [names.map((n) => n.toLowerCase())]);
      await tx.query(SQL.linkTechnologies, [inserted[0].id, techs.map((t) => t.id)]);
    }
  }
  for (const s of content.skills) {
    await tx.query(SQL.insertSkill, [s.name, s.category, s.proficiency_level ?? '', s.icon_url ?? '', s.display_order]);
  }
  for (const e of content.experiences) {
    await tx.query(SQL.insertExperience, [
      e.job_title,
      e.company_name,
      e.employment_type,
      e.start_date,
      e.end_date || null,
      e.description ?? '',
      e.responsibilities ?? [],
    ]);
  }
  for (const ed of content.education) {
    await tx.query(SQL.insertEducation, [
      ed.institution,
      ed.qualification,
      ed.field_of_study ?? '',
      ed.start_year,
      ed.end_year ?? null,
      ed.description ?? '',
    ]);
  }

  logger.info(
    `Sample content inserted: ${content.projects.length} project(s), ${content.skills.length} skill(s), ` +
      `${content.experiences.length} experience record(s), ${content.education.length} education record(s)`,
  );
  return 'inserted';
}
