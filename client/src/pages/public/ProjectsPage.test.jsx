// Projects page tests (Requirements 25.1, 25.2, 25.5, 25.6, 25.8, 25.9, 32.13, 33.3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ProjectsPage, { EMPTY_PROJECTS_MESSAGE } from './ProjectsPage.jsx';
import { SiteDataProvider } from '../../context/SiteDataContext.jsx';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import * as projectsApi from '../../api/projectsApi.js';
import * as settingsApi from '../../api/settingsApi.js';
import * as profileApi from '../../api/profileApi.js';

vi.mock('../../api/projectsApi.js', () => ({ listPublic: vi.fn(), getPublic: vi.fn() }));
vi.mock('../../api/settingsApi.js', () => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('../../api/profileApi.js', () => ({ get: vi.fn(), update: vi.fn() }));

class MockIntersectionObserver {
  observe() {}

  unobserve() {}

  disconnect() {}
}

const project = (id, title, category, extra = {}) => ({
  id,
  title,
  slug: title.toLowerCase().replace(/\s+/g, '-'),
  short_description: `${title} description`,
  category,
  image_url: '',
  github_url: '',
  live_demo_url: '',
  technologies: [],
  ...extra,
});

// API order deliberately not alphabetical, with categories in mixed letter case.
const PROJECTS = [
  project(1, 'Zeta Shop', 'web'),
  project(2, 'Alpha Bot', 'Mobile'),
  project(3, 'Mid Blog', 'Web'),
  project(4, 'Beta Tool', 'CLI'),
];

const networkError = () => new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <SiteDataProvider>
        <ProjectsPage />
      </SiteDataProvider>
    </MemoryRouter>,
  );
}

const cardTitles = () => screen.queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const filterGroup = () => screen.queryByRole('group', { name: 'Filter projects by category' });
const filterButtons = () => within(filterGroup()).getAllByRole('button');
const pressed = () => filterButtons().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  vi.mocked(settingsApi.get).mockResolvedValue({ site_title: 'Dev Portfolio' });
  vi.mocked(profileApi.get).mockResolvedValue({ name: 'Dev' });
  document.title = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ProjectsPage', () => {
  it('requests the projects once without a category and shows cards in API order in the projects grid', async () => {
    vi.mocked(projectsApi.listPublic).mockResolvedValue(PROJECTS);
    renderPage();

    expect(screen.getByRole('status').textContent).toMatch(/Loading/);
    await screen.findByRole('heading', { level: 2, name: 'Zeta Shop' });

    expect(projectsApi.listPublic).toHaveBeenCalledTimes(1);
    expect(projectsApi.listPublic.mock.calls[0][0].category).toBeUndefined();
    expect(cardTitles()).toEqual(['Zeta Shop', 'Alpha Bot', 'Mid Blog', 'Beta Tool']);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Projects']);

    const grid = screen.getByRole('list', { name: 'Projects' });
    expect(grid.classList.contains('grid--projects')).toBe(true);
    expect(within(grid).getAllByRole('link', { name: 'View Details' })[1].getAttribute('href')).toBe('/projects/alpha-bot');

    await waitFor(() => expect(document.title).toBe('Projects | Dev Portfolio'));
  });

  it('shows "All" first and selected, then the categories alphabetically, and filters client-side', async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.listPublic).mockResolvedValue(PROJECTS);
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Zeta Shop' });

    // "web" is the spelling of the first card in that category.
    expect(filterButtons().map((b) => b.textContent)).toEqual(['All', 'CLI', 'Mobile', 'web']);
    expect(pressed()).toEqual(['All']);

    await user.click(screen.getByRole('button', { name: 'web' }));
    expect(pressed()).toEqual(['web']);
    expect(cardTitles()).toEqual(['Zeta Shop', 'Mid Blog']);

    await user.click(screen.getByRole('button', { name: 'CLI' }));
    expect(pressed()).toEqual(['CLI']);
    expect(cardTitles()).toEqual(['Beta Tool']);

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(pressed()).toEqual(['All']);
    expect(cardTitles()).toEqual(['Zeta Shop', 'Alpha Bot', 'Mid Blog', 'Beta Tool']);

    expect(projectsApi.listPublic).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state and no cards or filters when no projects are published', async () => {
    vi.mocked(projectsApi.listPublic).mockResolvedValue([]);
    renderPage();

    await screen.findByText(EMPTY_PROJECTS_MESSAGE);
    expect(EMPTY_PROJECTS_MESSAGE).toBe('No projects are available yet.');
    expect(cardTitles()).toEqual([]);
    expect(filterGroup()).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the error with Retry and no filters or empty state, and Retry repeats the request', async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.listPublic).mockRejectedValueOnce(networkError()).mockResolvedValueOnce(PROJECTS);
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(NETWORK_ERROR_MESSAGE);
    expect(filterGroup()).toBeNull();
    expect(screen.queryByText(EMPTY_PROJECTS_MESSAGE)).toBeNull();
    expect(cardTitles()).toEqual([]);

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { level: 2, name: 'Zeta Shop' });
    expect(projectsApi.listPublic).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(pressed()).toEqual(['All']);
  });
});
