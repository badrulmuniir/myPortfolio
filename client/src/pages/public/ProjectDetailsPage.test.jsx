// Project Details page tests (Requirements 26.1-26.8, 21.6, 32.15).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import ProjectDetailsPage, { BACK_TO_PROJECTS_LABEL, PROJECT_NOT_FOUND_TITLE } from './ProjectDetailsPage.jsx';
import { SiteDataProvider } from '../../context/SiteDataContext.jsx';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import { PLACEHOLDER_PROJECT } from '../../assets/placeholders.js';
import * as projectsApi from '../../api/projectsApi.js';
import * as settingsApi from '../../api/settingsApi.js';
import * as profileApi from '../../api/profileApi.js';

vi.mock('../../api/projectsApi.js', () => ({ getPublic: vi.fn(), listPublic: vi.fn() }));
vi.mock('../../api/settingsApi.js', () => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('../../api/profileApi.js', () => ({ get: vi.fn(), update: vi.fn() }));

const SETTINGS = { site_title: 'My Site', hero_introduction: '', footer_text: '', social_links: [] };

const PROJECT = {
  id: 7,
  title: 'Task Tracker',
  slug: 'task-tracker',
  short_description: 'Tracks tasks',
  full_description: 'A full description.\nSecond line.',
  problem_statement: 'Teams lose track of <b>work</b>.',
  objectives: 'Ship quickly.',
  challenges: 'Realtime sync.',
  solutions: 'Websockets.',
  category: 'Web',
  image_url: 'https://img.example/task.png',
  github_url: 'https://github.com/dev/task-tracker',
  live_demo_url: 'https://tasks.example',
  display_order: 1,
  features: ['Zeta feature', 'Alpha feature', 'Mid feature'],
  technologies: [
    { id: 2, name: 'React', category: 'Frontend' },
    { id: 1, name: 'Node.js', category: 'Backend' },
  ],
};

const EMPTY_PROJECT = {
  ...PROJECT,
  full_description: null,
  problem_statement: '',
  objectives: '   ',
  challenges: '\n\t',
  solutions: null,
  image_url: '',
  github_url: '',
  live_demo_url: '',
  features: [],
  technologies: [],
};

let navigateTo;
function NavigatorProbe() {
  navigateTo = useNavigate();
  return null;
}

function renderAt(path = '/projects/task-tracker') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SiteDataProvider>
        <NavigatorProbe />
        <Routes>
          <Route path="/projects/:slug" element={<ProjectDetailsPage />} />
          <Route path="/projects" element={<h1>Projects list</h1>} />
        </Routes>
      </SiteDataProvider>
    </MemoryRouter>,
  );
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const h2Names = () => screen.queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const backLink = () => screen.getByRole('link', { name: BACK_TO_PROJECTS_LABEL });

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  vi.mocked(settingsApi.get).mockResolvedValue(SETTINGS);
  vi.mocked(profileApi.get).mockResolvedValue({ name: 'Dev' });
  document.title = '';
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('ProjectDetailsPage loaded state', () => {
  it('requests the slug and shows every section, features in order, technologies and new-tab links', async () => {
    vi.mocked(projectsApi.getPublic).mockResolvedValue(PROJECT);
    renderAt();

    expect(await screen.findByRole('heading', { level: 1, name: 'Task Tracker' })).toBeTruthy();
    expect(projectsApi.getPublic).toHaveBeenCalledTimes(1);
    expect(projectsApi.getPublic.mock.calls[0][0]).toBe('task-tracker');
    expect(projectsApi.getPublic.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h2Names()).toEqual([
      'Overview',
      'Problem statement',
      'Objectives',
      'Challenges',
      'Solutions',
      'Features',
      'Technologies',
    ]);

    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(overview.querySelector('.pre-line').textContent).toBe('A full description.\nSecond line.');

    // Plain text: markup is shown literally, never parsed (26.2).
    const problem = screen.getByRole('region', { name: 'Problem statement' });
    expect(problem.textContent).toContain('Teams lose track of <b>work</b>.');
    expect(problem.querySelector('b')).toBeNull();

    const features = within(screen.getByRole('region', { name: 'Features' })).getAllByRole('listitem');
    expect(features.map((li) => li.textContent)).toEqual(['Zeta feature', 'Alpha feature', 'Mid feature']);

    const techs = within(screen.getByRole('region', { name: 'Technologies' })).getAllByRole('listitem');
    expect(techs.map((li) => li.textContent)).toEqual(['React', 'Node.js']);

    for (const [name, href] of [
      ['GitHub', PROJECT.github_url],
      ['Live Demo', PROJECT.live_demo_url],
    ]) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }

    const img = screen.getByRole('img', { name: 'Task Tracker' });
    expect(img.getAttribute('src')).toBe(PROJECT.image_url);

    expect(backLink().getAttribute('href')).toBe('/projects');
    await waitFor(() => expect(document.title).toBe('Task Tracker | My Site'));
  });

  it('omits blank text sections, zero features, zero technologies and empty URLs', async () => {
    vi.mocked(projectsApi.getPublic).mockResolvedValue(EMPTY_PROJECT);
    renderAt();

    expect(await screen.findByRole('heading', { level: 1, name: 'Task Tracker' })).toBeTruthy();
    expect(h2Names()).toEqual([]);
    expect(screen.queryByRole('link', { name: 'GitHub' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Live Demo' })).toBeNull();
    expect(screen.queryAllByRole('list')).toHaveLength(0);

    // No image URL: placeholder whose alt contains the title (26.6).
    const img = screen.getByRole('img', { name: /Task Tracker/ });
    expect(img.getAttribute('src')).toBe(PLACEHOLDER_PROJECT);
    expect(backLink()).toBeTruthy();
  });

  it('swaps a failed image to the placeholder with the title as alt text', async () => {
    vi.mocked(projectsApi.getPublic).mockResolvedValue(PROJECT);
    renderAt();

    const img = await screen.findByRole('img', { name: 'Task Tracker' });
    expect(img.getAttribute('src')).toBe(PROJECT.image_url);
    fireEvent.error(img);
    expect(img.getAttribute('src')).toBe(PLACEHOLDER_PROJECT);
    expect(img.getAttribute('alt')).toContain('Task Tracker');
  });
});

describe('ProjectDetailsPage loading, not-found and error states', () => {
  it('shows a loading indicator, one h1 and the Projects link while pending', () => {
    vi.mocked(projectsApi.getPublic).mockReturnValue(new Promise(() => {}));
    renderAt();

    expect(screen.getByRole('status').textContent).toContain('Loading');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h2Names()).toEqual([]);
    expect(backLink().getAttribute('href')).toBe('/projects');
  });

  it('shows "Project not found" with a Projects link and no sections for a 404', async () => {
    vi.mocked(projectsApi.getPublic).mockRejectedValue(
      new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Project not found.' }),
    );
    renderAt('/projects/unpublished');

    expect(await screen.findByRole('heading', { level: 1, name: PROJECT_NOT_FOUND_TITLE })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h2Names()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();

    const user = userEvent.setup();
    await user.click(backLink());
    expect(screen.getByRole('heading', { level: 1, name: 'Projects list' })).toBeTruthy();
  });

  it.each([
    ['a 500 Error_Response', new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Server failed.' }), 'Server failed.'],
    ['a network failure', new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }), NETWORK_ERROR_MESSAGE],
  ])('shows the error with Retry and never "Project not found" for %s', async (_label, failure, message) => {
    vi.mocked(projectsApi.getPublic).mockRejectedValueOnce(failure).mockResolvedValueOnce(PROJECT);
    renderAt();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(message);
    expect(screen.queryByText(PROJECT_NOT_FOUND_TITLE)).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(backLink().getAttribute('href')).toBe('/projects');

    const user = userEvent.setup();
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Task Tracker' })).toBeTruthy();
    expect(projectsApi.getPublic).toHaveBeenCalledTimes(2);
    expect(projectsApi.getPublic.mock.calls[1][0]).toBe('task-tracker');
  });
});

describe('ProjectDetailsPage slug changes', () => {
  it('shows only the latest slug result when an earlier request resolves last', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(projectsApi.getPublic).mockImplementation((slug) =>
      slug === 'first' ? first.promise : second.promise,
    );
    renderAt('/projects/first');
    expect(projectsApi.getPublic).toHaveBeenLastCalledWith('first', expect.anything());

    act(() => navigateTo('/projects/second'));
    expect(projectsApi.getPublic).toHaveBeenLastCalledWith('second', expect.anything());
    expect(projectsApi.getPublic.mock.calls[0][1].signal.aborted).toBe(true);

    await act(async () => {
      second.resolve({ ...PROJECT, title: 'Second Project', slug: 'second' });
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Second Project' })).toBeTruthy();

    await act(async () => {
      first.resolve({ ...PROJECT, title: 'First Project', slug: 'first' });
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Second Project' })).toBeTruthy();
    expect(screen.queryByText('First Project')).toBeNull();
    await waitFor(() => expect(document.title).toBe('Second Project | My Site'));
  });
});
