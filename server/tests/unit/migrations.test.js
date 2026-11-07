// Static checks on the SQL migration files. They do not execute the SQL; the
// schema integration tests (task 3.4) cover behavior against a real database.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const RUNNER_PATTERN = /^(\d{3,})_[a-z0-9_]+\.sql$/;

const sqlFiles = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();

/** Removes comments and dollar-quoted function bodies, leaving top-level statements. */
function topLevelSql(sql) {
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, '$$$$')
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ');
}

const files = sqlFiles.map((name) => {
  const raw = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
  return { name, raw, sql: topLevelSql(raw) };
});
const allSql = files.map((f) => f.sql).join(' ');

/** Returns the body of `CREATE TABLE <table> ( ... );` with nested parentheses intact. */
function tableBody(table) {
  const match = new RegExp(`CREATE TABLE ${table} \\(`, 'i').exec(allSql);
  if (!match) return null;
  let depth = 1;
  let i = match.index + match[0].length;
  const start = i;
  for (; i < allSql.length && depth > 0; i += 1) {
    if (allSql[i] === '(') depth += 1;
    if (allSql[i] === ')') depth -= 1;
  }
  return allSql.slice(start, i - 1);
}

const TABLES = [
  'admins',
  'profile',
  'projects',
  'technologies',
  'project_technologies',
  'skills',
  'experiences',
  'education',
  'contact_messages',
  'settings',
];

// Requirement 2.5: which timestamp columns each table has.
const TIMESTAMPS = {
  admins: ['created_at', 'updated_at'],
  profile: ['created_at', 'updated_at'],
  projects: ['created_at', 'updated_at'],
  skills: ['created_at', 'updated_at'],
  experiences: ['created_at', 'updated_at'],
  education: ['created_at', 'updated_at'],
  technologies: ['created_at'],
  contact_messages: ['created_at'],
  settings: ['updated_at'],
  project_technologies: [],
};

describe('migration files', () => {
  it('are the ten files 001-010, matching the runner pattern with sequential versions', () => {
    expect(sqlFiles).toHaveLength(10);
    sqlFiles.forEach((name, index) => {
      const match = RUNNER_PATTERN.exec(name);
      expect(match, name).not.toBeNull();
      expect(Number(match[1])).toBe(index + 1);
    });
    expect(sqlFiles[0]).toBe('001_init_functions.sql');
    expect(sqlFiles[9]).toBe('010_create_settings.sql');
  });

  it('contain no transaction control or CONCURRENTLY outside function bodies', () => {
    for (const { name, sql } of files) {
      expect(sql, name).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
      expect(sql, name).not.toMatch(/\bCONCURRENTLY\b/i);
    }
  });

  it('create every table exactly once, each with a primary key', () => {
    for (const table of TABLES) {
      const creates = allSql.match(new RegExp(`CREATE TABLE ${table} \\(`, 'gi')) ?? [];
      expect(creates, table).toHaveLength(1);
      expect(tableBody(table), table).toMatch(/PRIMARY KEY/i);
    }
  });

  it('give each table exactly the timestamp columns of Requirement 2.5, not null with default now()', () => {
    for (const [table, columns] of Object.entries(TIMESTAMPS)) {
      const body = tableBody(table);
      for (const column of ['created_at', 'updated_at']) {
        const def = new RegExp(`\\b${column} TIMESTAMPTZ NOT NULL DEFAULT now\\(\\)`, 'i');
        if (columns.includes(column)) {
          expect(body, `${table}.${column}`).toMatch(def);
        } else {
          expect(body, `${table}.${column}`).not.toMatch(new RegExp(`\\b${column}\\b`, 'i'));
        }
      }
    }
  });

  it('attach an updated_at trigger to every table with updated_at, matching its columns', () => {
    for (const [table, columns] of Object.entries(TIMESTAMPS)) {
      const trigger = new RegExp(
        `CREATE TRIGGER \\w+ BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION (set_updated_at(?:_only)?)\\(\\)`,
        'i',
      ).exec(allSql);
      if (!columns.includes('updated_at')) {
        expect(trigger, table).toBeNull();
        continue;
      }
      expect(trigger, table).not.toBeNull();
      // set_updated_at() writes NEW.created_at, so it only fits tables that have created_at.
      const expected = columns.includes('created_at') ? 'set_updated_at' : 'set_updated_at_only';
      expect(trigger[1], table).toBe(expected);
    }
  });

  it('define both trigger functions in 001 with a non-decreasing updated_at', () => {
    const init = files[0].raw;
    expect(init).toMatch(/CREATE FUNCTION set_updated_at\(\) RETURNS trigger/);
    expect(init).toMatch(/CREATE FUNCTION set_updated_at_only\(\) RETURNS trigger/);
    expect(init.match(/GREATEST\(now\(\), OLD\.updated_at\)/g)).toHaveLength(2);
    expect(init).toMatch(/NEW\.created_at := OLD\.created_at/);
  });

  it('add the extra columns, with TEXT[] lists defaulting to empty', () => {
    expect(tableBody('admins')).toMatch(/\brole VARCHAR\(20\) NOT NULL DEFAULT 'admin'/i);
    for (const column of ['personal_introduction', 'career_interests', 'professional_goals']) {
      expect(tableBody('profile')).toMatch(new RegExp(`\\b${column} VARCHAR`, 'i'));
    }
    expect(tableBody('projects')).toMatch(/\bfeatures TEXT\[\] NOT NULL DEFAULT '\{\}'/i);
    expect(tableBody('experiences')).toMatch(/\bresponsibilities TEXT\[\] NOT NULL DEFAULT '\{\}'/i);
  });

  it('define the unique constraints of Requirement 2.2', () => {
    expect(tableBody('admins')).toMatch(/\bemail VARCHAR\(254\) NOT NULL UNIQUE/i);
    expect(tableBody('projects')).toMatch(/\bslug VARCHAR\(160\) NOT NULL UNIQUE/i);
    expect(tableBody('settings')).toMatch(/\bsetting_key VARCHAR\(50\) NOT NULL UNIQUE/i);
    expect(allSql).toMatch(/CREATE UNIQUE INDEX \w+ ON technologies \(lower\(name\)\)/i);
    expect(tableBody('project_technologies')).toMatch(/PRIMARY KEY \(project_id, technology_id\)/i);
  });

  it('cascade deletes on both project_technologies foreign keys', () => {
    const body = tableBody('project_technologies');
    expect(body).toMatch(/project_id INTEGER NOT NULL REFERENCES projects\(id\) ON DELETE CASCADE/i);
    expect(body).toMatch(/technology_id INTEGER NOT NULL REFERENCES technologies\(id\) ON DELETE CASCADE/i);
  });

  it('create the listing indexes of Requirement 2.4', () => {
    expect(allSql).toMatch(/CREATE INDEX \w+ ON projects \(is_published, display_order\)/i);
    expect(allSql).toMatch(/CREATE INDEX \w+ ON skills \(category, display_order\)/i);
    expect(allSql).toMatch(/CREATE INDEX \w+ ON contact_messages \(is_read, created_at\)/i);
  });

  it('define the date and year range checks of Requirement 2.9', () => {
    expect(tableBody('experiences')).toMatch(/CHECK \(end_date IS NULL OR end_date >= start_date\)/i);
    expect(tableBody('education')).toMatch(/CHECK \(end_year IS NULL OR end_year >= start_year\)/i);
  });
});
