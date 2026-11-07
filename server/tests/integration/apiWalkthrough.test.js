// End-to-end walkthrough of the API against the PostgreSQL test database (checkpoint 14).
//
// One app built with createApp, the real routers and services, a cost-4 hasher and the test db.
// The steps run in order and share state (token, ids): sign in, edit the profile and settings,
// manage skills, experiences, education and projects, go through the publication flow, submit
// and manage contact messages, and check that the dashboard counts match what was left behind.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAppConfig } from '../../src/config/env.js';
import { createHasher } from '../../src/utils/password.js';
import { TEST_ADMIN_PASSWORD, createAdmin, createProfile } from '../helpers/factories.js';
import { closeTestDb, getTestDb, resetDb } from '../helpers/testDb.js';

const config = loadAppConfig({
  JWT_SECRET: 'walkthrough-test-secret-at-least-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  // Only used by the config loader; the app uses the injected test db.
  DATABASE_URL: 'postgres://unused@localhost:5432/unused',
});
const db = getTestDb();
const app = createApp({ config, db, hasher: createHasher({ cost: 4 }) });

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** State shared by the ordered steps below. */
const state = { token: '', admin: null, skills: [], experiences: [], education: [], projects: [], messages: [] };

const as = (req) => req.set('Authorization', `Bearer ${state.token}`);
const api = {
  get: (path) => as(request(app).get(path)),
  post: (path, body) => as(request(app).post(path)).send(body),
  put: (path, body) => as(request(app).put(path)).send(body),
  patch: (path, body) => as(request(app).patch(path)).send(body),
  delete: (path) => as(request(app).delete(path)),
};

beforeAll(() => resetDb(db));
afterAll(() => closeTestDb());

describe('API walkthrough against the test database', () => {
  it('signs in an administrator created by the factory', async () => {
    state.admin = await createAdmin(db, { email: 'owner@example.com' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@example.com', password: TEST_ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.admin).toEqual({ id: state.admin.id, email: 'owner@example.com', role: 'admin' });
    expect(res.text).not.toContain('password_hash');
    state.token = res.body.data.token;

    const me = await api.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual({ id: state.admin.id, email: 'owner@example.com', role: 'admin' });
  });

  it('returns 404 for a profile update while no profile row exists, then 200 once it does', async () => {
    const body = { name: 'Ada Lovelace', professional_title: 'Engineer', email: 'ada@example.com', biography: 'Bio' };
    const missing = await api.put('/api/profile', body);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Profile not found' } });
    expect((await db.query('SELECT count(*)::int AS n FROM profile')).rows[0].n).toBe(0);

    await createProfile(db, { career_interests: 'Compilers' });
    const updated = await api.put('/api/profile', body);
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ ...body, career_interests: 'Compilers' });

    const publicRead = await request(app).get('/api/profile');
    expect(publicRead.status).toBe(200);
    expect(publicRead.body.data).toEqual(updated.body.data);
  });

  it('updates settings and serves them publicly', async () => {
    const res = await api.put('/api/settings', {
      site_title: 'Ada Portfolio',
      social_links: [{ label: 'GitHub', url: 'https://github.com/ada' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      site_title: 'Ada Portfolio',
      social_links: [{ label: 'GitHub', url: 'https://github.com/ada' }],
    });
    expect(Object.keys(res.body.data).sort()).toEqual(['footer_text', 'hero_introduction', 'site_title', 'social_links']);

    const publicRead = await request(app).get('/api/settings');
    expect(publicRead.body.data).toEqual(res.body.data);
  });

  it('creates, updates and deletes skills', async () => {
    const first = await api.post('/api/skills', { name: 'JavaScript', category: 'Programming Languages', display_order: 0 });
    const second = await api.post('/api/skills', { name: 'Go', category: 'Programming Languages', display_order: 1 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data).toEqual({
      id: first.body.data.id,
      name: 'JavaScript',
      category: 'Programming Languages',
      proficiency_level: '',
      icon_url: '',
      display_order: 0,
    });

    const updated = await api.put(`/api/skills/${first.body.data.id}`, {
      name: 'JavaScript',
      category: 'Programming Languages',
      proficiency_level: 'Expert',
      display_order: 0,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.proficiency_level).toBe('Expert');

    const removed = await api.delete(`/api/skills/${second.body.data.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ id: second.body.data.id });
    expect((await api.delete(`/api/skills/${second.body.data.id}`)).status).toBe(404);

    const list = await request(app).get('/api/skills');
    expect(list.body.data).toEqual([updated.body.data]);
  });

  it('creates, updates and deletes experiences, keeping omitted optional fields on update', async () => {
    const created = await api.post('/api/experiences', {
      job_title: 'Developer',
      company_name: 'Acme',
      employment_type: 'Full-time',
      start_date: '2021-03-01',
      description: 'Built things',
      responsibilities: ['Ship features', 'Review code'],
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ end_date: null, start_date: '2021-03-01' });

    const id = created.body.data.id;
    const updated = await api.put(`/api/experiences/${id}`, {
      job_title: 'Senior Developer',
      company_name: 'Acme',
      employment_type: 'Full-time',
      start_date: '2021-03-01',
      end_date: '2024-06-30',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toEqual({
      id,
      job_title: 'Senior Developer',
      company_name: 'Acme',
      employment_type: 'Full-time',
      start_date: '2021-03-01',
      end_date: '2024-06-30',
      description: 'Built things',
      responsibilities: ['Ship features', 'Review code'],
    });

    const other = await api.post('/api/experiences', {
      job_title: 'Intern',
      company_name: 'Initech',
      employment_type: 'Internship',
      start_date: '2020-06-01',
    });
    expect(other.status).toBe(201);
    expect((await api.delete(`/api/experiences/${other.body.data.id}`)).status).toBe(200);

    const list = await request(app).get('/api/experiences');
    expect(list.body.data).toEqual([updated.body.data]);
  });

  it('creates, updates and deletes education records', async () => {
    const created = await api.post('/api/education', {
      institution: 'University of London',
      qualification: 'BSc Mathematics',
      start_year: 2015,
      end_year: 2018,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const updated = await api.put(`/api/education/${id}`, {
      institution: 'University of London',
      qualification: 'BSc Mathematics',
      field_of_study: 'Mathematics',
      start_year: 2015,
    });
    expect(updated.status).toBe(200);
    // An Education PUT replaces every field, so the omitted end_year becomes null.
    expect(updated.body.data).toEqual({
      id,
      institution: 'University of London',
      qualification: 'BSc Mathematics',
      field_of_study: 'Mathematics',
      start_year: 2015,
      end_year: null,
      description: '',
    });

    const other = await api.post('/api/education', { institution: 'College', qualification: 'A-levels', start_year: 2013 });
    expect(other.status).toBe(201);
    expect((await api.delete(`/api/education/${other.body.data.id}`)).status).toBe(200);

    const list = await request(app).get('/api/education');
    expect(list.body.data).toEqual([updated.body.data]);
  });

  it('keeps a new project unpublished until it is published, then serves it by slug', async () => {
    const created = await api.post('/api/projects', {
      title: 'Task Tracker',
      short_description: 'Tracks tasks',
      category: 'Web',
      display_order: 0,
      features: ['Boards', 'Labels'],
      technologies: ['React', 'PostgreSQL'],
    });
    expect(created.status).toBe(201);
    const project = created.body.data;
    expect(project).toMatchObject({ slug: 'task-tracker', is_published: false, features: ['Boards', 'Labels'] });
    expect(project.technologies.map((t) => t.name)).toEqual(['PostgreSQL', 'React']);
    expect(project.created_at).toMatch(ISO_TIMESTAMP);
    expect(project.updated_at).toMatch(ISO_TIMESTAMP);
    state.projects.push(project);

    const draft = await api.post('/api/projects', {
      title: 'Draft Idea',
      short_description: 'Not ready',
      category: 'CLI',
      display_order: 1,
      technologies: ['react'],
    });
    expect(draft.status).toBe(201);
    // "react" reuses the existing Technology "React" (case-insensitive identity).
    expect(draft.body.data.technologies).toEqual([project.technologies.find((t) => t.name === 'React')]);

    const technologies = await api.get('/api/technologies');
    expect(technologies.body.data.map((t) => t.name)).toEqual(['PostgreSQL', 'React']);

    const publicBefore = await request(app).get('/api/projects');
    expect(publicBefore.status).toBe(200);
    expect(publicBefore.body.data).toEqual([]);
    expect((await request(app).get('/api/projects/task-tracker')).status).toBe(404);

    const adminList = await api.get('/api/admin/projects');
    expect(adminList.body.data.map((p) => p.id)).toEqual([project.id, draft.body.data.id]);

    const published = await api.patch(`/api/projects/${project.id}/publish`, { is_published: true });
    expect(published.status).toBe(200);
    expect(published.body.data.is_published).toBe(true);

    const bySlug = await request(app).get('/api/projects/task-tracker');
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.data).not.toHaveProperty('is_published');
    expect(bySlug.body.data).toMatchObject({ id: project.id, title: 'Task Tracker' });
    expect((await request(app).get(`/api/projects/${project.id}`)).body.data).toEqual(bySlug.body.data);

    const publicAfter = await request(app).get('/api/projects');
    expect(publicAfter.body.data.map((p) => p.id)).toEqual([project.id]);
  });

  it('accepts contact messages without a token and lets the admin manage them', async () => {
    for (const n of [1, 2, 3]) {
      const res = await request(app)
        .post('/api/contact')
        .send({ name: `Visitor ${n}`, email: `visitor${n}@example.com`, subject: 'Hello', message: 'I like your work a lot.' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: { received: true } });
    }

    const list = await api.get('/api/contact?limit=2');
    expect(list.status).toBe(200);
    expect(list.body.meta).toEqual({ total: 3, page: 1, limit: 2 });
    expect(list.body.data.map((m) => m.name)).toEqual(['Visitor 3', 'Visitor 2']);
    expect(list.body.data[0].created_at).toMatch(ISO_TIMESTAMP);
    state.messages = (await api.get('/api/contact')).body.data;

    const [newest, middle] = state.messages;
    const read = await api.get(`/api/contact/${newest.id}`);
    expect(read.status).toBe(200);
    expect(read.body.data).toEqual(newest);
    expect(read.body.data.is_read).toBe(false);

    const marked = await api.patch(`/api/contact/${newest.id}/read`, { is_read: true });
    expect(marked.status).toBe(200);
    expect(marked.body.data).toEqual({ ...newest, is_read: true });

    expect((await api.delete(`/api/contact/${middle.id}`)).status).toBe(200);
    expect((await api.get(`/api/contact/${middle.id}`)).status).toBe(404);

    const unread = await api.get('/api/contact?is_read=false');
    expect(unread.body.data.map((m) => m.name)).toEqual(['Visitor 1']);
    expect(unread.body.meta.total).toBe(1);
  });

  it('reports dashboard counts that match what the walkthrough left in the database', async () => {
    const res = await api.get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      projects_total: 2,
      projects_published: 1,
      skills: 1,
      experiences: 1,
      education: 1,
      messages_total: 2,
      messages_unread: 1,
    });
  });

  it('rejects admin endpoints without a token', async () => {
    for (const [method, path] of [
      ['get', '/api/dashboard/stats'],
      ['get', '/api/admin/projects'],
      ['get', '/api/contact'],
      ['put', '/api/profile'],
    ]) {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });
});
