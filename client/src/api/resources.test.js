import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '../../../server/src/routes/routeTable.js';
import { clearToken, setToken } from '../utils/tokenStorage.js';
import { setUnauthorizedHandler } from './apiClient.js';
import * as authApi from './authApi.js';
import * as contactApi from './contactApi.js';
import * as dashboardApi from './dashboardApi.js';
import * as educationApi from './educationApi.js';
import * as experiencesApi from './experiencesApi.js';
import * as healthApi from './healthApi.js';
import * as profileApi from './profileApi.js';
import * as projectsApi from './projectsApi.js';
import * as settingsApi from './settingsApi.js';
import * as skillsApi from './skillsApi.js';
import * as technologiesApi from './technologiesApi.js';

const BASE = 'https://api.example.com/api';
const TOKEN = 'header.payload.signature';

// Each case: the call, the server route it targets (method + catalog path), the concrete
// path below the base URL, and the JSON body expected (undefined = no body).
const CASES = [
  ['healthApi.getHealth', () => healthApi.getHealth(), 'GET', '/api/health', '/health'],
  ['authApi.login', () => authApi.login({ email: 'a@b.co', password: 'pw' }), 'POST', '/api/auth/login', '/auth/login', { email: 'a@b.co', password: 'pw' }],
  ['authApi.me', () => authApi.me(), 'GET', '/api/auth/me', '/auth/me'],
  ['profileApi.get', () => profileApi.get(), 'GET', '/api/profile', '/profile'],
  ['profileApi.update', () => profileApi.update({ name: 'N' }), 'PUT', '/api/profile', '/profile', { name: 'N' }],
  ['settingsApi.get', () => settingsApi.get(), 'GET', '/api/settings', '/settings'],
  ['settingsApi.update', () => settingsApi.update({ site_title: 'T' }), 'PUT', '/api/settings', '/settings', { site_title: 'T' }],
  ['projectsApi.listPublic', () => projectsApi.listPublic(), 'GET', '/api/projects', '/projects'],
  ['projectsApi.listPublic (category)', () => projectsApi.listPublic({ category: 'Web App' }), 'GET', '/api/projects', '/projects?category=Web+App'],
  ['projectsApi.getPublic', () => projectsApi.getPublic('my-project'), 'GET', '/api/projects/:identifier', '/projects/my-project'],
  ['projectsApi.getPublic (encoded)', () => projectsApi.getPublic('a/b?c'), 'GET', '/api/projects/:identifier', '/projects/a%2Fb%3Fc'],
  ['projectsApi.listAdmin', () => projectsApi.listAdmin(), 'GET', '/api/admin/projects', '/admin/projects'],
  ['projectsApi.getAdmin', () => projectsApi.getAdmin(7), 'GET', '/api/admin/projects/:id', '/admin/projects/7'],
  ['projectsApi.create', () => projectsApi.create({ title: 'P' }), 'POST', '/api/projects', '/projects', { title: 'P' }],
  ['projectsApi.update', () => projectsApi.update(7, { title: 'P' }), 'PUT', '/api/projects/:id', '/projects/7', { title: 'P' }],
  ['projectsApi.setPublished', () => projectsApi.setPublished(7, true), 'PATCH', '/api/projects/:id/publish', '/projects/7/publish', { is_published: true }],
  ['projectsApi.remove', () => projectsApi.remove(7), 'DELETE', '/api/projects/:id', '/projects/7'],
  ['technologiesApi.list', () => technologiesApi.list(), 'GET', '/api/technologies', '/technologies'],
  ['skillsApi.list', () => skillsApi.list(), 'GET', '/api/skills', '/skills'],
  ['skillsApi.create', () => skillsApi.create({ name: 'Go' }), 'POST', '/api/skills', '/skills', { name: 'Go' }],
  ['skillsApi.update', () => skillsApi.update(3, { name: 'Go' }), 'PUT', '/api/skills/:id', '/skills/3', { name: 'Go' }],
  ['skillsApi.remove', () => skillsApi.remove(3), 'DELETE', '/api/skills/:id', '/skills/3'],
  ['experiencesApi.list', () => experiencesApi.list(), 'GET', '/api/experiences', '/experiences'],
  ['experiencesApi.create', () => experiencesApi.create({ job_title: 'Dev' }), 'POST', '/api/experiences', '/experiences', { job_title: 'Dev' }],
  ['experiencesApi.update', () => experiencesApi.update(4, { job_title: 'Dev' }), 'PUT', '/api/experiences/:id', '/experiences/4', { job_title: 'Dev' }],
  ['experiencesApi.remove', () => experiencesApi.remove(4), 'DELETE', '/api/experiences/:id', '/experiences/4'],
  ['educationApi.list', () => educationApi.list(), 'GET', '/api/education', '/education'],
  ['educationApi.create', () => educationApi.create({ institution: 'U' }), 'POST', '/api/education', '/education', { institution: 'U' }],
  ['educationApi.update', () => educationApi.update(5, { institution: 'U' }), 'PUT', '/api/education/:id', '/education/5', { institution: 'U' }],
  ['educationApi.remove', () => educationApi.remove(5), 'DELETE', '/api/education/:id', '/education/5'],
  ['contactApi.submit', () => contactApi.submit({ name: 'N', website: '' }), 'POST', '/api/contact', '/contact', { name: 'N', website: '' }],
  ['contactApi.list', () => contactApi.list(), 'GET', '/api/contact', '/contact'],
  ['contactApi.list (query)', () => contactApi.list({ page: 2, limit: 50, isRead: false }), 'GET', '/api/contact', '/contact?page=2&limit=50&is_read=false'],
  ['contactApi.get', () => contactApi.get(9), 'GET', '/api/contact/:id', '/contact/9'],
  ['contactApi.setRead', () => contactApi.setRead(9, true), 'PATCH', '/api/contact/:id/read', '/contact/9/read', { is_read: true }],
  ['contactApi.remove', () => contactApi.remove(9), 'DELETE', '/api/contact/:id', '/contact/9'],
  ['dashboardApi.stats', () => dashboardApi.stats(), 'GET', '/api/dashboard/stats', '/dashboard/stats'],
];

const routeAuth = new Map(ROUTES.map((r) => [`${r.method} ${r.path}`, r.auth]));

let fetchMock;

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE);
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data: { ok: true }, meta: { total: 0, page: 1, limit: 20 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  setToken(TOKEN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setUnauthorizedHandler(null);
  clearToken();
});

describe('resource modules', () => {
  it('cover every endpoint in the server route table', () => {
    const covered = new Set(CASES.map(([, , method, route]) => `${method} ${route}`));
    expect([...covered].sort()).toEqual([...routeAuth.keys()].sort());
  });

  it.each(CASES)('%s sends the right method, URL, body and Authorization header', async (_name, call, method, route, path, body) => {
    expect(routeAuth.has(`${method} ${route}`)).toBe(true);
    await call();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}${path}`);
    expect(init.method).toBe(method);
    expect(init.body === undefined ? undefined : JSON.parse(init.body)).toEqual(body);

    // The stored token is attached exactly for protected endpoints (32.3).
    const expectedAuth = routeAuth.get(`${method} ${route}`) === 'admin' ? `Bearer ${TOKEN}` : undefined;
    expect(init.headers.Authorization).toBe(expectedAuth);
  });

  it('pass the caller signal through so an abort cancels the request', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = projectsApi.getPublic('slug', { signal: controller.signal }).catch((e) => e);
    controller.abort();
    expect((await pending).name).toBe('AbortError');
  });

  it('contactApi.list resolves with data and meta; other functions resolve with data', async () => {
    await expect(contactApi.list()).resolves.toEqual({ data: { ok: true }, meta: { total: 0, page: 1, limit: 20 } });
    await expect(skillsApi.list()).resolves.toEqual({ ok: true });
  });

  it('login and a bootstrap me() never call the unauthorized handler; a normal me() does', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }), {
        status: 401,
      }),
    );

    await authApi.login({ email: 'a@b.co', password: 'x' }).catch(() => {});
    await authApi.me({ skipUnauthorizedHandler: true }).catch(() => {});
    expect(handler).not.toHaveBeenCalled();

    await authApi.me().catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(TOKEN);
  });
});
