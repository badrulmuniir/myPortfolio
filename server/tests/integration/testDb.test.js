// Checks the test database helpers against the real test database (Requirement 38.11).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createContactMessage,
  createProfile,
  createProject,
  createSetting,
  createTechnology,
  linkProjectTechnology,
} from '../helpers/factories.js';
import { closeTestDb, getTestDb, listAppTables, resetDb, snapshot } from '../helpers/testDb.js';

const APP_TABLES = [
  'admins',
  'contact_messages',
  'education',
  'experiences',
  'profile',
  'project_technologies',
  'projects',
  'settings',
  'skills',
  'technologies',
];

const db = getTestDb();

beforeAll(() => resetDb(db));
afterAll(() => closeTestDb());

describe('test database helpers', () => {
  it('runs on a fully migrated schema', async () => {
    const { rows } = await db.query('SELECT version FROM schema_migrations ORDER BY version');
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await listAppTables(db)).toEqual(APP_TABLES);
  });

  it('inserts valid rows through the factories', async () => {
    const project = await createProject(db, { features: ['Search', 'Filters'] });
    const tech = await createTechnology(db, { name: 'React' });
    await linkProjectTechnology(db, project.id, tech.id);
    const profile = await createProfile(db);
    const setting = await createSetting(db, 'social_links', [{ label: 'GitHub', url: 'https://github.com/x' }]);

    expect(project).toMatchObject({ id: 1, is_published: false, features: ['Search', 'Filters'] });
    expect(project.slug).toMatch(/^test-project-\d+$/);
    expect(profile.id).toBe(1);
    expect(setting.setting_value).toEqual([{ label: 'GitHub', url: 'https://github.com/x' }]);
  });

  it('snapshots every table ordered by primary key', async () => {
    await createContactMessage(db);
    await createContactMessage(db);
    const snap = await snapshot(db);
    expect(Object.keys(snap)).toEqual(APP_TABLES);
    expect(snap.contact_messages.map((r) => r.id)).toEqual([1, 2]);
    expect(snap.project_technologies).toEqual([{ project_id: 1, technology_id: 1 }]);
    expect(await snapshot(db)).toEqual(snap);
    await expect(snapshot(db, ['schema_migrations'])).rejects.toThrow(/unknown table/);
  });

  it('resetDb empties every table, restarts identities and keeps schema_migrations', async () => {
    await resetDb(db);
    const snap = await snapshot(db);
    for (const table of APP_TABLES) expect(snap[table]).toEqual([]);

    const { rows } = await db.query('SELECT count(*)::int AS n FROM schema_migrations');
    expect(rows[0].n).toBe(10);
    expect((await createProject(db)).id).toBe(1);
  });
});
