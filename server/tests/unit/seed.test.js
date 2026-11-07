// Unit tests for the Seed_Script: configuration, hasher, seed service and CLI, with no PostgreSQL.
// Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9.
import { EventEmitter } from 'node:events';
import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/seed.js';
import { sampleContent } from '../../seed/sampleContent.js';
import { ConfigError, isValidEmail, loadSeedConfig } from '../../src/config/env.js';
import { createDb } from '../../src/db/pool.js';
import { DEFAULT_SETTINGS, SQL, SeedError, runSeed } from '../../src/services/seedService.js';
import { createLogger } from '../../src/utils/logger.js';
import { createHasher, hasher as productionHasher } from '../../src/utils/password.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const VALID_ENV = { ADMIN_EMAIL: '  Owner@Example.COM ', ADMIN_PASSWORD: PASSWORD };
const fastHasher = createHasher({ cost: 4 });

function captureLogger() {
  const lines = [];
  const push = (l) => lines.push(l);
  return { lines, logger: createLogger({ sink: { info: push, warn: push, error: push } }) };
}

const seedError = (env) => {
  try {
    loadSeedConfig(env);
  } catch (err) {
    return err;
  }
  throw new Error('expected loadSeedConfig to throw');
};

describe('loadSeedConfig', () => {
  it('accepts valid input, normalizes the email and keeps the password untrimmed', () => {
    const config = loadSeedConfig({ ...VALID_ENV, ADMIN_PASSWORD: ` ${PASSWORD} ` });
    expect(config.adminEmail).toBe('owner@example.com');
    expect(config.adminPassword).toBe(` ${PASSWORD} `);
    expect(config.sampleContent).toBe(false);
  });

  it('keeps the password out of serialized output', () => {
    const config = loadSeedConfig(VALID_ENV);
    expect(JSON.stringify(config)).not.toContain(PASSWORD);
    expect(Object.keys(config)).not.toContain('adminPassword');
  });

  it('parses SEED_SAMPLE_CONTENT case-insensitively', () => {
    expect(loadSeedConfig({ ...VALID_ENV, SEED_SAMPLE_CONTENT: 'TRUE' }).sampleContent).toBe(true);
    expect(loadSeedConfig({ ...VALID_ENV, SEED_SAMPLE_CONTENT: 'false' }).sampleContent).toBe(false);
  });

  it('accepts a password of exactly 12 characters and exactly 72 bytes', () => {
    expect(() => loadSeedConfig({ ...VALID_ENV, ADMIN_PASSWORD: 'a'.repeat(12) })).not.toThrow();
    expect(() => loadSeedConfig({ ...VALID_ENV, ADMIN_PASSWORD: 'a'.repeat(72) })).not.toThrow();
    // 24 three-byte characters = 72 bytes.
    expect(() => loadSeedConfig({ ...VALID_ENV, ADMIN_PASSWORD: '€'.repeat(24) })).not.toThrow();
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['11 characters', 'a'.repeat(11)],
    ['73 ASCII bytes', 'a'.repeat(73)],
    ['73 bytes of multibyte characters (25 x 3 bytes = 75)', '€'.repeat(25)],
    ['73 bytes mixing ASCII and multibyte', `${'€'.repeat(24)}a`],
  ])('rejects ADMIN_PASSWORD when %s', (_label, value) => {
    const err = seedError({ ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: value });
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.variables).toEqual(['ADMIN_PASSWORD']);
    if (value) expect(err.message).not.toContain(value);
  });

  it.each([
    ['unset', undefined],
    ['blank', '   '],
    ['without @', 'owner.example.com'],
    ['without a dot in the domain', 'owner@localhost'],
    ['with an empty domain label', 'owner@example..com'],
    ['with whitespace', 'own er@example.com'],
    ['longer than 254 characters', `${'a'.repeat(250)}@example.com`],
  ])('rejects ADMIN_EMAIL when %s', (_label, value) => {
    const err = seedError({ ADMIN_EMAIL: value, ADMIN_PASSWORD: PASSWORD });
    expect(err.variables).toEqual(['ADMIN_EMAIL']);
    if (value?.trim()) expect(err.message).not.toContain(value.trim());
  });

  it('rejects an invalid SEED_SAMPLE_CONTENT without echoing it', () => {
    const err = seedError({ ...VALID_ENV, SEED_SAMPLE_CONTENT: 'yes-please' });
    expect(err.variables).toEqual(['SEED_SAMPLE_CONTENT']);
    expect(err.message).not.toContain('yes-please');
  });

  it('names every invalid variable at once, with no values and no defaults', () => {
    const err = seedError({ ADMIN_EMAIL: 'not-an-email', ADMIN_PASSWORD: 'short-pw', SEED_SAMPLE_CONTENT: 'maybe' });
    expect(err.variables).toEqual(['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'SEED_SAMPLE_CONTENT']);
    for (const value of ['not-an-email', 'short-pw', 'maybe']) expect(err.message).not.toContain(value);
    expect(seedError({}).variables).toEqual(['ADMIN_EMAIL', 'ADMIN_PASSWORD']);
  });

  it('isValidEmail follows the Valid_Email definition', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('first.last+tag@sub.example.org')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a@.b.co')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(242)}@example.com`)).toBe(true); // 254 characters
    expect(isValidEmail(`${'a'.repeat(243)}@example.com`)).toBe(false); // 255 characters
  });
});

describe('password hasher', () => {
  it('hashes with the configured cost and compares correctly', async () => {
    const hash = await fastHasher.hash(PASSWORD);
    expect(bcrypt.getRounds(hash)).toBe(4);
    expect(hash).not.toContain(PASSWORD);
    expect(await fastHasher.compare(PASSWORD, hash)).toBe(true);
    expect(await fastHasher.compare(`${PASSWORD}x`, hash)).toBe(false);
  });

  it('uses cost 12 by default', async () => {
    expect(productionHasher.cost).toBe(12);
    const hash = await productionHasher.hash(PASSWORD);
    expect(bcrypt.getRounds(hash)).toBe(12);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('rejects an invalid cost', () => {
    expect(() => createHasher({ cost: 3 })).toThrow(RangeError);
    expect(() => createHasher({ cost: 12.5 })).toThrow(RangeError);
  });
});

/**
 * A fake db with one transaction client. It records statements and answers the seed queries from
 * `state`. Writes are staged and only counted as committed when the transaction succeeds.
 */
function fakeDb({ adminExists = false, hasContent = false, failOn = () => undefined } = {}) {
  const state = { statements: [], params: [], committed: false, rolledBack: false };
  let nextProjectId = 1;
  const tx = {
    async query(text, params = []) {
      state.statements.push(text);
      state.params.push(params);
      const failure = failOn(text, params);
      if (failure) throw failure;
      switch (text) {
        case SQL.anyAdmin:
          return { rows: adminExists ? [{ '?column?': 1 }] : [] };
        case SQL.insertProfile:
          return { rows: [{ id: 1 }] };
        case SQL.insertSettings:
          return { rows: params[0].map((k) => ({ setting_key: k })) };
        case SQL.contentExists:
          return { rows: [{ has_content: hasContent }] };
        case SQL.insertProject:
          return { rows: [{ id: nextProjectId++ }] };
        case SQL.selectTechnologyIds:
          return { rows: params[0].map((_, i) => ({ id: i + 1 })) };
        default:
          return { rows: [] };
      }
    },
  };
  const db = {
    state,
    async withTransaction(work) {
      try {
        const result = await work(tx);
        state.committed = true;
        return result;
      } catch (err) {
        state.rolledBack = true;
        throw err;
      }
    },
    describeError: (err) => err.message,
    end: vi.fn(async () => {}),
  };
  return db;
}

const config = (overrides = {}) => ({ ...loadSeedConfig(VALID_ENV), adminPassword: PASSWORD, ...overrides });
const count = (db, sql) => db.state.statements.filter((s) => s === sql).length;

describe('runSeed', () => {
  it('creates the admin with a bcrypt hash, the profile and the four settings on the first run', async () => {
    const db = fakeDb();
    const { logger } = captureLogger();
    const summary = await runSeed({ db, config: config(), hasher: fastHasher, logger });

    expect(summary).toEqual({
      admin: 'created',
      profile: 'created',
      settingsCreated: ['site_title', 'hero_introduction', 'footer_text', 'social_links'],
      sample: 'disabled',
    });
    expect(db.state.committed).toBe(true);

    const adminIdx = db.state.statements.indexOf(SQL.insertAdmin);
    const [email, hash] = db.state.params[adminIdx];
    expect(email).toBe('owner@example.com');
    expect(await bcrypt.compare(PASSWORD, hash)).toBe(true);

    const profileParams = db.state.params[db.state.statements.indexOf(SQL.insertProfile)];
    expect(profileParams).toEqual(['Your Name', 'Software Developer', 'owner@example.com']);

    const [keys, values] = db.state.params[db.state.statements.indexOf(SQL.insertSettings)];
    expect(keys).toEqual(Object.keys(DEFAULT_SETTINGS));
    expect(values.map((v) => JSON.parse(v))).toEqual(['My Portfolio', '', '', []]);
    expect(count(db, SQL.contentExists)).toBe(0);
  });

  it('creates no admin when one exists, reports it and continues with the other steps', async () => {
    const db = fakeDb({ adminExists: true });
    const { lines, logger } = captureLogger();
    const hasher = { hash: vi.fn(fastHasher.hash) };
    const summary = await runSeed({ db, config: config(), hasher, logger });

    expect(summary.admin).toBe('exists');
    expect(count(db, SQL.insertAdmin)).toBe(0);
    expect(hasher.hash).not.toHaveBeenCalled();
    expect(count(db, SQL.insertProfile)).toBe(1);
    expect(count(db, SQL.insertSettings)).toBe(1);
    expect(lines.join('\n')).toContain('Admin account already exists');
  });

  it('inserts every sample record when enabled and the content tables are empty', async () => {
    const db = fakeDb({ adminExists: true });
    const { logger } = captureLogger();
    const summary = await runSeed({ db, config: config({ sampleContent: true }), hasher: fastHasher, logger });

    expect(summary.sample).toBe('inserted');
    expect(count(db, SQL.insertProject)).toBe(sampleContent.projects.length);
    expect(count(db, SQL.linkTechnologies)).toBe(sampleContent.projects.length);
    expect(count(db, SQL.insertSkill)).toBe(sampleContent.skills.length);
    expect(count(db, SQL.insertExperience)).toBe(sampleContent.experiences.length);
    expect(count(db, SQL.insertEducation)).toBe(sampleContent.education.length);
  });

  it('skips sample content when the database already has content', async () => {
    const db = fakeDb({ hasContent: true });
    const { lines, logger } = captureLogger();
    const summary = await runSeed({ db, config: config({ sampleContent: true }), hasher: fastHasher, logger });

    expect(summary.sample).toBe('skipped');
    expect(count(db, SQL.insertProject)).toBe(0);
    expect(count(db, SQL.insertSkill)).toBe(0);
    expect(lines.join('\n')).toContain('Sample content skipped');
  });

  it.each([
    ['admin', SQL.insertAdmin],
    ['profile', SQL.insertProfile],
    ['settings', SQL.insertSettings],
    ['sample', SQL.insertSkill],
  ])('rolls back and names the %s step when it fails, without the password', async (step, failingSql) => {
    const db = fakeDb({
      failOn: (text) => (text === failingSql ? new Error(`relation failed near '${PASSWORD}'`) : undefined),
    });
    const { lines, logger } = captureLogger();
    const err = await runSeed({ db, config: config({ sampleContent: true }), hasher: fastHasher, logger }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(SeedError);
    expect(err.step).toBe(step);
    expect(err.message).toContain(`Seed step "${step}" failed`);
    expect(err.message).not.toContain(PASSWORD);
    expect(db.state.rolledBack).toBe(true);
    expect(db.state.committed).toBe(false);
    expect(lines.join('\n')).not.toContain(PASSWORD);
  });

  it('names the hasher failure as the admin step without the password', async () => {
    const db = fakeDb();
    const hasher = {
      hash: async (pw) => {
        throw new Error(`cannot hash ${pw}`);
      },
    };
    const err = await runSeed({ db, config: config(), hasher, logger: captureLogger().logger }).catch((e) => e);
    expect(err.step).toBe('admin');
    expect(err.message).not.toContain(PASSWORD);
  });
});

describe('seed CLI main', () => {
  const DB_PASSWORD = 'Db-S3cret-pw';
  const DATABASE_URL = `postgres://portfolio_user:${DB_PASSWORD}@db.example.com:6543/portfolio`;
  const ENV = { ...VALID_ENV, DATABASE_URL };

  it('exits 1 naming every invalid variable, without creating a db', async () => {
    const { lines, logger } = captureLogger();
    const createDbFn = vi.fn();
    const code = await main({
      env: { ADMIN_EMAIL: 'bad', ADMIN_PASSWORD: 'short', DB_SSL: 'maybe', PGPASSWORD: DB_PASSWORD },
      logger,
      createDbFn,
    });

    expect(code).toBe(1);
    expect(createDbFn).not.toHaveBeenCalled();
    const output = lines.join('\n');
    for (const name of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'DB_SSL', 'PGHOST', 'PGUSER', 'PGDATABASE']) {
      expect(output).toContain(name);
    }
    for (const value of ['short', 'maybe', DB_PASSWORD]) expect(output).not.toContain(value);
  });

  it('exits 0 after a successful run, closes the pool and never logs the password', async () => {
    const { lines, logger } = captureLogger();
    const db = fakeDb();
    const code = await main({ env: ENV, logger, createDbFn: () => db, hasher: fastHasher });

    expect(code).toBe(0);
    expect(db.end).toHaveBeenCalledTimes(1);
    expect(db.state.committed).toBe(true);
    expect(lines.join('\n')).not.toContain(PASSWORD);
  });

  it('exits 1 with a credential-free message when the database cannot be reached', async () => {
    const { lines, logger } = captureLogger();
    const pool = new EventEmitter();
    pool.connect = async () => {
      throw Object.assign(new Error(`connect ECONNREFUSED ${DATABASE_URL} ${PASSWORD}`), { code: 'ECONNREFUSED' });
    };
    pool.end = vi.fn(async () => {});
    const code = await main({
      env: ENV,
      logger,
      createDbFn: (cfg, opts) => createDb(cfg, { ...opts, poolFactory: () => pool }),
      hasher: fastHasher,
    });

    expect(code).toBe(1);
    expect(pool.end).toHaveBeenCalled();
    const output = lines.join('\n');
    expect(output).toContain('Seed step "connect" failed: ECONNREFUSED');
    expect(output).toContain('db.example.com:6543/portfolio');
    for (const secret of [PASSWORD, DB_PASSWORD, 'portfolio_user', DATABASE_URL]) {
      expect(output).not.toContain(secret);
    }
  });

  it('exits 1 naming the failed step when a write fails', async () => {
    const { lines, logger } = captureLogger();
    const db = fakeDb({
      failOn: (text) => (text === SQL.insertSettings ? new Error('relation "settings" does not exist') : undefined),
    });
    const code = await main({ env: ENV, logger, createDbFn: () => db, hasher: fastHasher });

    expect(code).toBe(1);
    expect(db.end).toHaveBeenCalledTimes(1);
    expect(db.state.rolledBack).toBe(true);
    const output = lines.join('\n');
    expect(output).toContain('Seed step "settings" failed: relation "settings" does not exist');
    expect(output).not.toContain(PASSWORD);
  });
});

describe('sample content fixtures', () => {
  // Simple checks of the Validator rules; task 5.10 runs the fixtures through the real schemas.
  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const len = (s) => [...s.trim()].length;
  const between = (s, min, max) => typeof s === 'string' && len(s) >= min && len(s) <= max;
  const urlOrEmpty = (s) => {
    if (s === '') return true;
    try {
      const u = new URL(s);
      return s.length <= 2048 && (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname !== '';
    } catch {
      return false;
    }
  };
  const isoDate = (s) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  const intIn = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  const year = new Date().getUTCFullYear();

  it('has at least one record of each type', () => {
    for (const key of ['projects', 'skills', 'experiences', 'education']) {
      expect(sampleContent[key].length).toBeGreaterThan(0);
    }
  });

  it('projects satisfy the project rules and have valid, unique slugs', () => {
    const slugs = sampleContent.projects.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const p of sampleContent.projects) {
      expect(SLUG_RE.test(p.slug) && /[a-z]/.test(p.slug) && p.slug.length <= 160).toBe(true);
      expect(between(p.title, 1, 150)).toBe(true);
      expect(between(p.short_description, 1, 300)).toBe(true);
      expect(between(p.category, 1, 50)).toBe(true);
      for (const f of ['full_description', 'problem_statement', 'objectives', 'challenges', 'solutions']) {
        expect(between(p[f], 0, 10000)).toBe(true);
      }
      for (const f of ['image_url', 'github_url', 'live_demo_url']) expect(urlOrEmpty(p[f])).toBe(true);
      expect(intIn(p.display_order, 0, 9999)).toBe(true);
      expect(typeof p.is_published).toBe('boolean');
      expect(p.features.length).toBeLessThanOrEqual(30);
      for (const f of p.features) expect(between(f, 1, 300)).toBe(true);
      expect(p.technologies.length).toBeGreaterThan(0);
      for (const t of p.technologies) expect(between(t, 1, 50)).toBe(true);
    }
  });

  it('skills satisfy the skill rules', () => {
    for (const s of sampleContent.skills) {
      expect(between(s.name, 1, 50)).toBe(true);
      expect(between(s.category, 1, 50)).toBe(true);
      expect(['', 'Beginner', 'Intermediate', 'Advanced', 'Expert']).toContain(s.proficiency_level);
      expect(urlOrEmpty(s.icon_url)).toBe(true);
      expect(intIn(s.display_order, 0, 9999)).toBe(true);
    }
  });

  it('experiences satisfy the experience rules', () => {
    for (const e of sampleContent.experiences) {
      expect(between(e.job_title, 1, 100)).toBe(true);
      expect(between(e.company_name, 1, 100)).toBe(true);
      expect(['Full-time', 'Part-time', 'Internship', 'Contract', 'Freelance', 'Volunteer']).toContain(e.employment_type);
      expect(isoDate(e.start_date)).toBe(true);
      if (e.end_date) expect(isoDate(e.end_date) && e.end_date >= e.start_date).toBe(true);
      expect(between(e.description, 0, 5000)).toBe(true);
      expect(e.responsibilities.length).toBeLessThanOrEqual(20);
      for (const r of e.responsibilities) expect(between(r, 1, 300)).toBe(true);
    }
  });

  it('education records satisfy the education rules', () => {
    for (const ed of sampleContent.education) {
      expect(between(ed.institution, 1, 150)).toBe(true);
      expect(between(ed.qualification, 1, 150)).toBe(true);
      expect(between(ed.field_of_study, 0, 150)).toBe(true);
      expect(intIn(ed.start_year, 1950, year + 10)).toBe(true);
      if (ed.end_year !== null) expect(intIn(ed.end_year, ed.start_year, year + 10)).toBe(true);
      expect(between(ed.description, 0, 5000)).toBe(true);
    }
  });
});
