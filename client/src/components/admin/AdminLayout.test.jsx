// Admin layout tests (Requirements 6.3, 31.1, 31.2, 34.6, 34.7, 34.9).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext.jsx';
import { clearToken, getToken, setToken } from '../../utils/tokenStorage.js';
import * as authApi from '../../api/authApi.js';
import { AdminLayout } from './AdminLayout.jsx';
import { SIDEBAR_ID } from './Sidebar.jsx';

vi.mock('../../api/authApi.js', () => ({ login: vi.fn(), me: vi.fn() }));

const EMAIL = 'admin@example.com';
const NAV_ORDER = ['Overview', 'Projects', 'Skills', 'Experience', 'Education', 'Messages', 'Profile', 'Settings'];

const Page = ({ title }) => <h1>{title}</h1>;

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/admin/login" element={<Page title="Sign in" />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Page title="Dashboard overview" />} />
            <Route path="projects" element={<Page title="Projects" />} />
            <Route path="projects/new" element={<Page title="New project" />} />
            <Route path="projects/:id/edit" element={<Page title="Edit project" />} />
            <Route path="skills" element={<Page title="Skills" />} />
            <Route path="messages/:id" element={<Page title="Message" />} />
            <Route path="settings" element={<Page title="Settings" />} />
            <Route path="*" element={<Page title="Page not found" />} />
          </Route>
        </Routes>
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const adminNav = () => screen.getByRole('navigation', { name: 'Admin' });
const currentLinks = () => within(adminNav()).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
const toggle = () => screen.getByRole('button', { name: 'Menu' });
const sidebar = () => document.getElementById(SIDEBAR_ID);

beforeEach(() => {
  setToken('stored-token');
  vi.mocked(authApi.me).mockResolvedValue({ id: 1, email: EMAIL, role: 'admin' });
});

afterEach(() => {
  clearToken();
  vi.clearAllMocks();
});

describe('AdminLayout landmarks', () => {
  it('renders the skip link first, one main#main, one h1 and the admin email', async () => {
    const user = userEvent.setup();
    renderAt('/admin/projects');
    expect(await screen.findByText(EMAIL)).toBeTruthy();

    const main = screen.getByRole('main');
    expect(main.id).toBe('main');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.map((h) => h.textContent)).toEqual(['Projects']);
    expect(main.contains(headings[0])).toBe(true);

    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(document.activeElement).toBe(skip);
    await user.click(skip);
    expect(document.activeElement).toBe(main);
  });

  it('lists the sidebar links in order with their paths', () => {
    renderAt('/admin');
    const links = within(adminNav()).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(NAV_ORDER);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/admin',
      '/admin/projects',
      '/admin/skills',
      '/admin/experience',
      '/admin/education',
      '/admin/messages',
      '/admin/profile',
      '/admin/settings',
    ]);
  });
});

describe('Sidebar aria-current', () => {
  it.each([
    ['/admin', 'Overview'],
    ['/admin/projects', 'Projects'],
    ['/admin/projects/new', 'Projects'],
    ['/admin/projects/7/edit', 'Projects'],
    ['/admin/skills', 'Skills'],
    ['/admin/messages/3', 'Messages'],
    ['/admin/settings', 'Settings'],
  ])('marks exactly one link on %s', (path, label) => {
    renderAt(path);
    const active = currentLinks();
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe(label);
  });

  it('marks no link on an unknown admin path', () => {
    renderAt('/admin/unknown');
    expect(currentLinks()).toHaveLength(0);
  });
});

describe('Topbar logout', () => {
  it('clears the session and navigates to /admin/login without another request', async () => {
    const user = userEvent.setup();
    renderAt('/admin/skills');
    await screen.findByText(EMAIL);

    await user.click(screen.getByRole('button', { name: 'Logout' }));
    expect(screen.getByTestId('location').textContent).toBe('/admin/login');
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    expect(getToken()).toBeNull();
    expect(authApi.me).toHaveBeenCalledTimes(1);
    expect(authApi.login).not.toHaveBeenCalled();
  });
});

describe('Sidebar toggle', () => {
  it('starts closed and exposes its state with aria-expanded and aria-controls', async () => {
    const user = userEvent.setup();
    renderAt('/admin');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-controls')).toBe(SIDEBAR_ID);
    expect(sidebar().contains(adminNav())).toBe(true);
    expect(sidebar().dataset.open).toBe('false');

    await user.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(sidebar().dataset.open).toBe('true');
    expect(document.activeElement).toBe(within(adminNav()).getByRole('link', { name: 'Overview' }));

    await user.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(sidebar().dataset.open).toBe('false');
  });

  it('closes after a link is selected and moves focus to main', async () => {
    const user = userEvent.setup();
    renderAt('/admin');
    await user.click(toggle());
    await user.click(within(adminNav()).getByRole('link', { name: 'Skills' }));

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(sidebar().dataset.open).toBe('false');
    expect(screen.getByRole('heading', { level: 1, name: 'Skills' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('closes when the current page link is selected', async () => {
    const user = userEvent.setup();
    renderAt('/admin/skills');
    await user.click(toggle());
    await user.click(within(adminNav()).getByRole('link', { name: 'Skills' }));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('closes on Escape and returns focus to the toggle', async () => {
    const user = userEvent.setup();
    renderAt('/admin');
    await user.click(toggle());
    await user.keyboard('{Escape}');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
  });

  it('closes on a backdrop click and returns focus to the toggle', async () => {
    const user = userEvent.setup();
    renderAt('/admin');
    expect(screen.queryByTestId('admin-backdrop')).toBeNull();
    await user.click(toggle());
    await user.click(screen.getByTestId('admin-backdrop'));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('admin-backdrop')).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });
});

describe('route focus', () => {
  it('does not move focus on first render', async () => {
    renderAt('/admin');
    await waitFor(() => expect(authApi.me).toHaveBeenCalled());
    expect(document.activeElement).toBe(document.body);
  });
});
