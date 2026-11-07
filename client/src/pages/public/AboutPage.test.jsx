import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AboutPage, { ABOUT_EMPTY_MESSAGE, EDUCATION_SECTION_TITLE } from './AboutPage.jsx';
import { SiteDataProvider } from '../../context/SiteDataContext.jsx';
import { get as getSettings } from '../../api/settingsApi.js';
import { get as getProfile } from '../../api/profileApi.js';
import { list as listEducation } from '../../api/educationApi.js';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';

vi.mock('../../api/settingsApi.js', () => ({ get: vi.fn() }));
vi.mock('../../api/profileApi.js', () => ({ get: vi.fn() }));
vi.mock('../../api/educationApi.js', () => ({ list: vi.fn() }));

const SETTINGS = { site_title: 'Ada Dev', hero_introduction: '', footer_text: '', social_links: [] };

const PROFILE = {
  name: 'Ada Lovelace',
  professional_title: 'Engineer',
  personal_introduction: 'Hello there.',
  biography: 'Line one\nLine two <b>bold</b>',
  career_interests: 'Compilers',
  professional_goals: 'Ship things',
  profile_image_url: '',
  email: 'ada@example.com',
  github_url: '',
  linkedin_url: '',
};

const EDUCATION = [
  { id: 2, institution: 'University B', qualification: 'MSc Computing', field_of_study: '', start_year: 2020, end_year: 2022, description: '' },
  { id: 1, institution: 'College A', qualification: 'BSc Maths', field_of_study: '', start_year: 2016, end_year: 2019, description: '' },
];

const serverError = () =>
  new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/about']}>
      <SiteDataProvider>
        <AboutPage />
      </SiteDataProvider>
    </MemoryRouter>,
  );

const headingTexts = (level) =>
  screen.queryAllByRole('heading', { level }).map((heading) => heading.textContent);

beforeEach(() => {
  vi.mocked(getSettings).mockResolvedValue(SETTINGS);
});

afterEach(() => {
  vi.mocked(getSettings).mockReset();
  vi.mocked(getProfile).mockReset();
  vi.mocked(listEducation).mockReset();
  document.title = '';
});

describe('AboutPage', () => {
  it('shows loading indicators for both sources while the requests run', () => {
    vi.mocked(getProfile).mockReturnValue(new Promise(() => {}));
    vi.mocked(listEducation).mockReturnValue(new Promise(() => {}));
    renderPage();

    const status = screen.getAllByRole('status').map((el) => el.textContent);
    expect(status).toEqual(['Loading profile…', 'Loading education…']);
    expect(headingTexts(1)).toEqual(['About']);
  });

  it('shows the four Profile sections in order, then education in API order', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE);
    vi.mocked(listEducation).mockResolvedValue(EDUCATION);
    renderPage();

    await screen.findByRole('heading', { level: 2, name: EDUCATION_SECTION_TITLE });
    expect(headingTexts(1)).toEqual(['About']);
    expect(headingTexts(2)).toEqual([
      'Personal Introduction',
      'Biography',
      'Career Interests',
      'Professional Goals',
      EDUCATION_SECTION_TITLE,
    ]);
    expect(screen.getByRole('region', { name: 'Career Interests' }).textContent).toContain('Compilers');

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'MSc ComputingUniversity B',
      'BSc MathsCollege A',
    ]);
    expect(listEducation.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(document.title).toBe('About | Ada Dev'));
  });

  it('renders text as plain text with line breaks and literal HTML', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE);
    vi.mocked(listEducation).mockResolvedValue([]);
    renderPage();

    const region = await screen.findByRole('region', { name: 'Biography' });
    const paragraph = region.querySelector('p');
    expect(paragraph.textContent).toBe('Line one\nLine two <b>bold</b>');
    expect(paragraph.className).toContain('pre-line');
    expect(region.querySelector('b')).toBeNull();
  });

  it('omits whitespace-only Profile sections and the empty education section', async () => {
    vi.mocked(getProfile).mockResolvedValue({ ...PROFILE, biography: '  \n\t ', career_interests: '' });
    vi.mocked(listEducation).mockResolvedValue([]);
    renderPage();

    await screen.findByRole('heading', { level: 2, name: 'Personal Introduction' });
    expect(headingTexts(2)).toEqual(['Personal Introduction', 'Professional Goals']);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(ABOUT_EMPTY_MESSAGE)).toBeNull();
  });

  it('shows the empty-state message when all five sections are omitted', async () => {
    vi.mocked(getProfile).mockResolvedValue({
      ...PROFILE,
      personal_introduction: '',
      biography: ' ',
      career_interests: '\n',
      professional_goals: '',
    });
    vi.mocked(listEducation).mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(ABOUT_EMPTY_MESSAGE)).toBeTruthy();
    expect(headingTexts(2)).toEqual([]);
    expect(headingTexts(1)).toEqual(['About']);
  });

  it('keeps the education section and shows Retry for the Profile when only the Profile fails', async () => {
    vi.mocked(getProfile).mockRejectedValueOnce(serverError()).mockResolvedValueOnce(PROFILE);
    vi.mocked(listEducation).mockResolvedValue(EDUCATION);
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('An unexpected error occurred');
    await screen.findByRole('heading', { level: 2, name: EDUCATION_SECTION_TITLE });
    expect(headingTexts(2)).toEqual([EDUCATION_SECTION_TITLE]);
    expect(screen.queryByText(ABOUT_EMPTY_MESSAGE)).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { level: 2, name: 'Biography' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect(listEducation).toHaveBeenCalledTimes(1);
  });

  it('keeps the Profile sections and shows Retry for education when only education fails', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE);
    vi.mocked(listEducation)
      .mockRejectedValueOnce(
        new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }),
      )
      .mockResolvedValueOnce(EDUCATION);
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(NETWORK_ERROR_MESSAGE);
    await screen.findByRole('heading', { level: 2, name: 'Professional Goals' });
    expect(headingTexts(2)).toHaveLength(4);

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { level: 2, name: EDUCATION_SECTION_TITLE });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(listEducation).toHaveBeenCalledTimes(2);
    expect(getProfile).toHaveBeenCalledTimes(1);
  });

  it('shows the error state instead of the empty state when education fails and the Profile is empty', async () => {
    vi.mocked(getProfile).mockResolvedValue({
      ...PROFILE,
      personal_introduction: '',
      biography: '',
      career_interests: '',
      professional_goals: '',
    });
    vi.mocked(listEducation).mockRejectedValue(serverError());
    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(ABOUT_EMPTY_MESSAGE)).toBeNull();
  });
});
