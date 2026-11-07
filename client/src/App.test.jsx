// Routing and route-guard tests (Requirements 6.8, 21.5, 30.5, 30.6, 30.7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ApiError, NETWORK_ERROR_MESSAGE } from './api/apiClient.js';
import * as authApi from './api/authApi.js';
import * as settingsApi from './api/settingsApi.js';
import * as profileApi from './api/profileApi.js';
import * as dashboardApi from './api/dashboardApi.js';
import * as skillsApi from './api/skillsApi.js';

vi.mock('./api/authApi.js', () => ({ login: vi.fn(), me: vi.fn() }));
vi.mock('./api/settingsApi.js', () => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('./api/profileApi.js', () => ({ get: vi.fn(), update: vi.fn() }));
// Admin pages rendered by these routing tests must not reach the network.
vi.mock('./api/dashboardApi.js', () => ({ stats: vi.fn() }));
vi.mock('./api/skillsApi.js', () => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }));

const TOKEN_KEY = 'portfolio.admin.token';

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location" data-from={location.state?.from ?? ''}>
      {location.pathname}
    </output>
  );
}

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const probe = () => screen.getByTestId('location');

beforeEach(() => {
  vi.mocked(settingsApi.get).mockResolvedValue({ site_title: 'My Site', hero_introduction: '', footer_text: '', social_links: [] });
  vi.mocked(profileApi.get).mockResolvedValue({ name: 'Dev', github_url: '', linkedin_url: '' });
  vi.mocked(dashboardApi.stats).mockResolvedValue({
    projects_total: 0, projects_published: 0, skills: 0, experiences: 0, education: 0,
    messages_total: 0, messages_unread: 0,
  });
  vi.mocked(skillsApi.list).mockResolvedValue([]);
});

afterEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe('public routes', () => {
  it('shows the not-found page for an unknown path and keeps the path', async () => {
    renderApp('/nope');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Go to the Home page' }).getAttribute('href')).toBe('/');
    expect(probe().textContent).toBe('/nope');
    await waitFor(() => expect(document.title).toBe('Page not found | My Site'));
  });
});

describe('admin route guards', () => {
  it('redirects an unauthenticated visitor to /admin/login and remembers the path', async () => {
    renderApp('/admin/projects?page=2');
    await waitFor(() => expect(probe().textContent).toBe('/admin/login'));
    expect(probe().dataset.from).toBe('/admin/projects?page=2');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it('never sends an /admin path to the public not-found page', async () => {
    renderApp('/admin/does-not-exist');
    await waitFor(() => expect(probe().textContent).toBe('/admin/login'));
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('redirects an authenticated admin from /admin/login to /admin', async () => {
    window.sessionStorage.setItem(TOKEN_KEY, 'valid-token');
    vi.mocked(authApi.me).mockResolvedValue({ id: 1, email: 'a@example.com', role: 'admin' });
    renderApp('/admin/login');
    await waitFor(() => expect(probe().textContent).toBe('/admin'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard overview' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeTruthy();
  });

  it('shows a loading indicator and no protected content while the session is checked', async () => {
    window.sessionStorage.setItem(TOKEN_KEY, 'pending-token');
    vi.mocked(authApi.me).mockReturnValue(new Promise(() => {}));
    renderApp('/admin/projects');
    expect(await screen.findByText('Checking your session…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Projects' })).toBeNull();
    expect(probe().textContent).toBe('/admin/projects');
  });

  it('shows an error with Retry when verification fails, and Retry checks again', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem(TOKEN_KEY, 'kept-token');
    vi.mocked(authApi.me)
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }))
      .mockResolvedValueOnce({ id: 1, email: 'a@example.com', role: 'admin' });
    renderApp('/admin/skills');

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(probe().textContent).toBe('/admin/skills');
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBe('kept-token');

    await user.click(retry);
    expect(await screen.findByRole('heading', { level: 1, name: 'Skills' })).toBeTruthy();
    expect(authApi.me).toHaveBeenCalledTimes(2);
    expect(probe().textContent).toBe('/admin/skills');
  });
});
