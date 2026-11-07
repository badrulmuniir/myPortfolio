import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SkillsPage, { SKILLS_EMPTY_MESSAGE } from './SkillsPage.jsx';
import { SiteDataProvider } from '../../context/SiteDataContext.jsx';
import { list as listSkills } from '../../api/skillsApi.js';
import { get as getSettings } from '../../api/settingsApi.js';
import { get as getProfile } from '../../api/profileApi.js';
import { ApiError } from '../../api/apiClient.js';
import { PLACEHOLDER_ICON } from '../../assets/placeholders.js';

vi.mock('../../api/skillsApi.js', () => ({ list: vi.fn() }));
vi.mock('../../api/settingsApi.js', () => ({ get: vi.fn() }));
vi.mock('../../api/profileApi.js', () => ({ get: vi.fn() }));

class MockIntersectionObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.elements = [];
    MockIntersectionObserver.instances.push(this);
  }

  observe(el) {
    this.elements.push(el);
  }

  unobserve() {}

  disconnect() {}

  static intersectAll() {
    for (const o of MockIntersectionObserver.instances) {
      o.callback(o.elements.map((target) => ({ target, isIntersecting: true, intersectionRatio: 1 })), o);
    }
  }
}

const SETTINGS = { site_title: 'Ada Dev', hero_introduction: '', footer_text: '', social_links: [] };
const ICON_URL = 'https://icons.example.com/react.svg';

const SKILLS = [
  { id: 1, name: 'React', category: 'Frontend', proficiency_level: 'Expert', icon_url: ICON_URL, display_order: 1 },
  { id: 2, name: 'Node.js', category: 'Backend', proficiency_level: '', icon_url: '', display_order: 2 },
  { id: 3, name: 'CSS', category: 'Frontend', proficiency_level: 'Advanced', icon_url: '', display_order: 3 },
  { id: 4, name: 'Docker', category: 'Tools', proficiency_level: null, icon_url: null, display_order: 4 },
  { id: 5, name: 'PostgreSQL', category: 'Backend', proficiency_level: 'Intermediate', icon_url: '', display_order: 5 },
];

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/skills']}>
      <SiteDataProvider>
        <SkillsPage />
      </SiteDataProvider>
    </MemoryRouter>,
  );

const headingTexts = (level) => screen.queryAllByRole('heading', { level }).map((h) => h.textContent);

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  vi.mocked(getSettings).mockResolvedValue(SETTINGS);
  vi.mocked(getProfile).mockResolvedValue({ name: 'Ada' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  MockIntersectionObserver.instances = [];
  vi.mocked(listSkills).mockReset();
  vi.mocked(getSettings).mockReset();
  vi.mocked(getProfile).mockReset();
});

describe('SkillsPage', () => {
  it('groups skills under one h2 per category in first-appearance order, keeping API order (24.1)', async () => {
    vi.mocked(listSkills).mockResolvedValue(SKILLS);
    renderPage();

    await screen.findByRole('heading', { level: 2, name: 'Frontend' });
    expect(headingTexts(1)).toEqual(['Skills']);
    expect(headingTexts(2)).toEqual(['Frontend', 'Backend', 'Tools']);
    expect(listSkills).toHaveBeenCalledTimes(1);
    expect(listSkills.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);

    const namesIn = (category) => {
      const section = screen.getByRole('region', { name: category });
      return within(section)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('.skills-item__name').textContent);
    };
    expect(namesIn('Frontend')).toEqual(['React', 'CSS']);
    expect(namesIn('Backend')).toEqual(['Node.js', 'PostgreSQL']);
    expect(namesIn('Tools')).toEqual(['Docker']);
    // Every skill name appears exactly once on the page.
    for (const skill of SKILLS) expect(screen.getAllByText(skill.name)).toHaveLength(1);
    expect(screen.queryByText(SKILLS_EMPTY_MESSAGE)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the proficiency level as text only when present (24.2)', async () => {
    vi.mocked(listSkills).mockResolvedValue(SKILLS);
    renderPage();
    await screen.findByText('React');

    const itemOf = (name) => screen.getByText(name).closest('li');
    expect(itemOf('React').textContent).toBe('ReactExpert');
    expect(itemOf('CSS').textContent).toBe('CSSAdvanced');
    expect(itemOf('PostgreSQL').textContent).toBe('PostgreSQLIntermediate');
    expect(itemOf('Node.js').textContent).toBe('Node.js');
    expect(itemOf('Docker').textContent).toBe('Docker');
    expect(itemOf('Node.js').querySelector('.skills-item__level')).toBeNull();
  });

  it('shows icons as decorative images and the placeholder for missing or failed icons (24.3, 24.5)', async () => {
    vi.mocked(listSkills).mockResolvedValue(SKILLS);
    renderPage();
    await screen.findByText('React');

    const iconOf = (name) => screen.getByText(name).closest('li').querySelector('img');
    for (const skill of SKILLS) expect(iconOf(skill.name).getAttribute('alt')).toBe('');
    // Decorative images are not exposed as named images.
    expect(screen.queryAllByRole('img', { name: /.+/ })).toHaveLength(0);

    for (const name of ['Node.js', 'CSS', 'Docker', 'PostgreSQL']) {
      expect(iconOf(name).getAttribute('src')).toBe(PLACEHOLDER_ICON);
    }

    // The list renders outside act, so LazyImage's observer effect may not have run yet.
    await waitFor(() => expect(MockIntersectionObserver.instances.length).toBeGreaterThan(0));
    act(() => MockIntersectionObserver.intersectAll());
    expect(iconOf('React').getAttribute('src')).toBe(ICON_URL);

    fireEvent.error(iconOf('React'));
    expect(iconOf('React').getAttribute('src')).toBe(PLACEHOLDER_ICON);
    expect(iconOf('React').getAttribute('alt')).toBe('');
  });

  it('shows only a loading indicator while the request runs (24.6)', async () => {
    let resolve;
    vi.mocked(listSkills).mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();

    expect(screen.getByRole('status').textContent).toMatch(/loading/i);
    expect(headingTexts(1)).toEqual(['Skills']);
    expect(headingTexts(2)).toEqual([]);
    expect(screen.queryByText(SKILLS_EMPTY_MESSAGE)).toBeNull();

    await act(async () => resolve(SKILLS));
    expect(headingTexts(2)).toEqual(['Frontend', 'Backend', 'Tools']);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the empty-state message and no category headings for an empty list (24.4)', async () => {
    vi.mocked(listSkills).mockResolvedValue([]);
    renderPage();

    await screen.findByText(SKILLS_EMPTY_MESSAGE);
    expect(SKILLS_EMPTY_MESSAGE).toBe('No skills are listed yet.');
    expect(headingTexts(1)).toEqual(['Skills']);
    expect(headingTexts(2)).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error with a Retry button that repeats the request (24.7)', async () => {
    vi.mocked(listSkills)
      .mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Server exploded' }))
      .mockResolvedValueOnce(SKILLS);
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Server exploded');
    expect(headingTexts(2)).toEqual([]);
    expect(screen.queryByText(SKILLS_EMPTY_MESSAGE)).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { level: 2, name: 'Frontend' });
    expect(listSkills).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sets the document title to "Skills | site_title"', async () => {
    vi.mocked(listSkills).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(document.title).toBe('Skills | Ada Dev'));
  });
});
