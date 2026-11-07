// Integration tests for the Seed_Script against the PostgreSQL test database.
// Requirements 3.1, 3.3, 3.4, 3.5, 3.6, 3.7.
import bcrypt from 'bcryptjs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sampleContent } from '../../seed/sampleContent.js';
import { loadSeedConfig } from '../../src/config/env.js';
import { SQL, SeedError, runSeed } from '../../src/services/seedService.js';
import { createLogger } from '../../src/utils/logger.js';
import { createHasher } from '../../src/utils/password.js';
import { createAdmin, createProfile, createSetting, createSkill } from '../helpers/factories.js';
import { closeTestDb, getTestDb, resetDb, snapshot } from '../helpers/testDb.js';

const PASSWORD = 'Integration-Seed-Pw-1';
const hasher = createHasher({ cost: 4 });
const db = getTestDb();

function captureLogger() {
  const lines = [];
  const push = (l) => lines.push(l);
  return { lines, logger: createLogger({ sink: { info: push, warn: push, error: push } }) };
}

const seedConfig = (env = {}) =>
  loadSeedConfig({ ADMIN_EMAIL: ' Owner@Example.com ', ADMIN_PASSWORD: PASSWORD, ...env });

const seed = (env, options = {}) =>
  runSeed({ db, config: seedConfig(env), hasher, logger: captureLogger().logger, ...options });

beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

describe('Seed_Script against the test database', () => {
  it('first run creates one admin with a bcrypt hash, the profile and the four settings', async () => {
    await seed();

    const { rows: admins } = await db.query('SELECT email, role, password_hash FROM admins');
    expect(admins).toHaveLength(1);
    expect(admins[0]).toMatchObject({ email: 'owner@example.com', role: 'admin' });
    expect(await bcrypt.compare(PASSWORD, admins[0].password_hash)).toBe(true);

    const { rows: profile } = await db.query('SELECT id, name, professional_title, email FROM profile');
    expect(profile).toEqual([{ id: 1, name: 'Your Name', professional_title: 'Software Developer', email: 'owner@example.com' }]);

    const { rows: settings } = await db.query('SELECT setting_key, setting_value FROM settings ORDER BY setting_key');
    expect(Object.fromEntries(settings.map((r) => [r.setting_key, r.setting_value]))).toEqual({
      footer_text: '',
      hero_introduction: '',
      site_title: 'My Portfolio',
      social_links: [],
    });
  });

  it('a second run changes nothing', async () => {
    await seed();
    const before = await snapshot(db);
    const summary = await seed({ ADMIN_EMAIL: 'other@example.com' });
    expect(summary).toMatchObject({ admin: 'exists', profile: 'exists', settingsCreated: [] });
    expect(await snapshot(db)).toEqual(before);
  });

  it('keeps existing admins, profile and settings values unchanged', async () => {
    const admin = await createAdmin(db, { email: 'existing@example.com' });
    await createProfile(db, { name: 'Existing Name' });
    await createSetting(db, 'site_title', 'Kept Title');

    const summary = await seed();
    expect(summary).toMatchObject({ admin: 'exists', profile: 'exists' });
    expect(summary.settingsCreated.sort()).toEqual(['footer_text', 'hero_introduction', 'social_links']);

    const snap = await snapshot(db, ['admins', 'profile', 'settings']);
    expect(snap.admins).toEqual([admin]);
    expect(snap.profile[0].name).toBe('Existing Name');
    expect(snap.settings.find((s) => s.setting_key === 'site_title').setting_value).toBe('Kept Title');
  });

  it('inserts sample content into an empty database', async () => {
    const summary = await seed({ SEED_SAMPLE_CONTENT: 'true' });
    expect(summary.sample).toBe('inserted');

    const counts = await db.query(
      `SELECT (SELECT count(*) FROM projects)::int AS projects, (SELECT count(*) FROM skills)::int AS skills,
              (SELECT count(*) FROM experiences)::int AS experiences, (SELECT count(*) FROM education)::int AS education`,
    );
    expect(counts.rows[0]).toEqual({
      projects: sampleContent.projects.length,
      skills: sampleContent.skills.length,
      experiences: sampleContent.experiences.length,
      education: sampleContent.education.length,
    });
    const { rows: links } = await db.query(
      `SELECT p.slug, array_agg(t.name ORDER BY t.name) AS techs
         FROM projects p JOIN project_technologies pt ON pt.project_id = p.id
         JOIN technologies t ON t.id = pt.technology_id GROUP BY p.slug ORDER BY p.slug`,
    );
    for (const p of sampleContent.projects) {
      expect(links.find((l) => l.slug === p.slug).techs).toEqual([...p.technologies].sort());
    }
  });

  it('skips sample content when any content exists', async () => {
    await createSkill(db, { name: 'Existing Skill' });
    const before = await snapshot(db, ['projects', 'skills', 'experiences', 'education']);
    const { lines, logger } = captureLogger();
    const summary = await seed({ SEED_SAMPLE_CONTENT: 'true' }, { logger });
    expect(summary.sample).toBe('skipped');
    expect(await snapshot(db, ['projects', 'skills', 'experiences', 'education'])).toEqual(before);
    expect(lines.join('\n')).toContain('Sample content skipped');
  });

  it('rolls back every write and names the step when a write fails', async () => {
    const failing = {
      ...db,
      withTransaction: (work) =>
        db.withTransaction((tx) =>
          work({
            query: (text, params) =>
              text === SQL.insertSkill ? tx.query('INSERT INTO missing_table VALUES (1)') : tx.query(text, params),
          }),
        ),
    };
    const { lines, logger } = captureLogger();
    const err = await runSeed({
      db: failing,
      config: seedConfig({ SEED_SAMPLE_CONTENT: 'true' }),
      hasher,
      logger,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(SeedError);
    expect(err.step).toBe('sample');
    expect(err.message).toContain('missing_table');
    expect(err.message).not.toContain(PASSWORD);
    expect(lines.join('\n')).not.toContain(PASSWORD);

    const snap = await snapshot(db);
    for (const rows of Object.values(snap)) expect(rows).toEqual([]);
  });
});
