// Public layout tests (Requirements 21.1-21.4, 21.6, 21.8, 21.9, 34.6, 34.7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App.jsx';
import { AuthProvider } from '../../context/AuthContext.jsx';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import * as settingsApi from '../../api/settingsApi.js';
import * as profileApi from '../../api/profileApi.js';

vi.mock('../../api/authApi.js', () => ({ login: vi.fn(), me: vi.fn() }));
vi.mock('../../api/settingsApi.js', () => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('../../api/profileApi.js', () => ({ get: vi.fn(), update: vi.fn() }));
// The pages rendered here load their own content; keep those requests off the network.
vi.mock('../../api/projectsApi.js', () => ({
  listPublic: vi.fn(() => Promise.resolve([])),
  getPublic: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../../api/skillsApi.js', () => ({ list: vi.fn(() => Promise.resolve([])) }));
vi.mock('../../api/experiencesApi.js', () => ({ list: vi.fn(() => Promise.resolve([])) }));
vi.mock('../../api/educationApi.js', () => ({ list: vi.fn(() => Promise.resolve([])) }));
vi.mock('../../api/contactApi.js', () => ({ submit: vi.fn() }));

const NAV_ORDER = ['Home', 'About', 'Skills', 'Projects', 'Experience', 'Education', 'Contact'];
const networkError = () => new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE });

const SETTINGS = {
  site_title: 'My Site',
  hero_introduction: '',
  footer_text: 'Built with care',
  social_links: [
    { label: 'Mastodon', url: 'https://mastodon.example/@dev' },
    { label: 'Blog', url: 'https://blog.example' },
  ],
};
const PROFILE = { name: 'Dev', github_url: 'https://github.com/dev', linkedin_url: 'https://linkedin.com/in/dev' };

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const mainNav = () => screen.getByRole('navigation', { name: 'Main' });
const currentLinks = () => within(mainNav()).queryAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');

beforeEach(() => {
  vi.mocked(settingsApi.get).mockResolvedValue(SETTINGS);
  vi.mocked(profileApi.get).mockResolvedValue(PROFILE);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PublicLayout landmarks and skip link', () => {
  it('renders header, nav, main#main, footer and one h1, with the skip link as first Tab stop', async () => {
    const user = userEvent.setup();
    renderAt('/about');
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    const main = screen.getByRole('main');
    expect(main.id).toBe('main');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(document.activeElement).toBe(skip);
    await user.click(skip);
    expect(document.activeElement).toBe(main);
  });
});

describe('Navbar', () => {
  it('lists the links in the required order', () => {
    renderAt('/');
    expect(within(mainNav()).getAllByRole('link').map((a) => a.textContent)).toEqual(NAV_ORDER);
  });

  it.each([
    ['/', 'Home'],
    ['/about', 'About'],
    ['/projects', 'Projects'],
    ['/projects/my-project', 'Projects'],
    ['/contact', 'Contact'],
  ])('marks exactly one link active on %s', (path, label) => {
    renderAt(path);
    const active = currentLinks();
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe(label);
  });

  it('marks no link active on the not-found page', () => {
    renderAt('/nope');
    expect(currentLinks()).toHaveLength(0);
  });

  it('starts collapsed, toggles aria-expanded, closes on link selection and on Escape', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(mainNav().id);

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await user.click(within(mainNav()).getByRole('link', { name: 'Skills' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('heading', { level: 1, name: 'Skills' })).toBeTruthy();

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    within(mainNav()).getByRole('link', { name: 'About' }).focus();
    await user.keyboard('{Escape}');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });
});

describe('Footer', () => {
  it('shows footer text, profile links, social links in order and the current year', async () => {
    renderAt('/');
    const footer = screen.getByRole('contentinfo');
    expect(await within(footer).findByText('Built with care')).toBeTruthy();
    await waitFor(() =>
      expect(within(footer).getAllByRole('link').map((a) => a.textContent)).toEqual(['GitHub', 'LinkedIn', 'Mastodon', 'Blog']),
    );
    for (const link of within(footer).getAllByRole('link')) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(footer.textContent).toContain(String(new Date().getFullYear()));
  });

  it('omits empty footer text, empty profile URLs and missing social links', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ ...SETTINGS, footer_text: '', social_links: [] });
    vi.mocked(profileApi.get).mockResolvedValue({ ...PROFILE, github_url: '' });
    renderAt('/');
    const footer = screen.getByRole('contentinfo');
    await waitFor(() => expect(within(footer).getAllByRole('link').map((a) => a.textContent)).toEqual(['LinkedIn']));
    expect(within(footer).queryByText('Built with care')).toBeNull();
  });

  it('keeps nav and page content and shows only the year when settings and profile fail', async () => {
    vi.mocked(settingsApi.get).mockRejectedValue(networkError());
    vi.mocked(profileApi.get).mockRejectedValue(networkError());
    renderAt('/about');
    await waitFor(() => expect(settingsApi.get).toHaveBeenCalled());
    const footer = screen.getByRole('contentinfo');
    await waitFor(() => expect(document.title).toBe('About'));
    expect(within(footer).queryAllByRole('link')).toHaveLength(0);
    expect(footer.textContent).toContain(String(new Date().getFullYear()));
    expect(mainNav()).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'About' })).toBeTruthy();
  });
});

describe('document title', () => {
  it('is "<page> | <site_title>" once settings load', async () => {
    renderAt('/education');
    await waitFor(() => expect(document.title).toBe('Education | My Site'));
  });

  it('is the page name alone while settings are loading', () => {
    vi.mocked(settingsApi.get).mockReturnValue(new Promise(() => {}));
    renderAt('/experience');
    expect(document.title).toBe('Experience');
  });
});
