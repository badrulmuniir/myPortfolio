import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EducationPage, { EDUCATION_EMPTY_MESSAGE } from './EducationPage.jsx';
import { SiteDataProvider } from '../../context/SiteDataContext.jsx';
import { list as listEducation } from '../../api/educationApi.js';
import { get as getSettings } from '../../api/settingsApi.js';
import { get as getProfile } from '../../api/profileApi.js';
import { ApiError } from '../../api/apiClient.js';

vi.mock('../../api/educationApi.js', () => ({ list: vi.fn() }));
vi.mock('../../api/settingsApi.js', () => ({ get: vi.fn() }));
vi.mock('../../api/profileApi.js', () => ({ get: vi.fn() }));

const SETTINGS = { site_title: 'Ada Dev', hero_introduction: '', footer_text: '', social_links: [] };

// Deliberately not in any sorted order, to show the page keeps the API order (28.1).
const EDUCATION = [
  {
    id: 7,
    institution: 'College A',
    qualification: 'BSc Mathematics',
    field_of_study: 'Applied Mathematics',
    start_year: 2019,
    end_year: 2023,
    description: 'First line\nSecond line <b>bold</b>',
  },
  {
    id: 3,
    institution: 'University B',
    qualification: 'MSc Computing',
    field_of_study: '',
    start_year: 2021,
    end_year: null,
    description: '',
  },
  {
    id: 9,
    institution: 'School C',
    qualification: 'Diploma',
    field_of_study: '   ',
    start_year: 2010,
    end_year: 2012,
    description: '   ',
  },
];

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/education']}>
      <SiteDataProvider>
        <EducationPage />
      </SiteDataProvider>
    </MemoryRouter>,
  );

const headingTexts = (level) => screen.queryAllByRole('heading', { level }).map((h) => h.textContent);
const entryOf = (qualification) =>
  screen.getByRole('heading', { level: 2, name: qualification }).closest('li');

beforeEach(() => {
  vi.mocked(getSettings).mockResolvedValue(SETTINGS);
  vi.mocked(getProfile).mockResolvedValue({ name: 'Ada' });
});

afterEach(() => {
  vi.mocked(listEducation).mockReset();
  vi.mocked(getSettings).mockReset();
  vi.mocked(getProfile).mockReset();
});

describe('EducationPage', () => {
  it('shows one entry per record in API order with all fields (28.1, 28.2)', async () => {
    vi.mocked(listEducation).mockResolvedValue(EDUCATION);
    renderPage();

    await screen.findByRole('heading', { level: 2, name: 'BSc Mathematics' });
    expect(headingTexts(1)).toEqual(['Education']);
    expect(headingTexts(2)).toEqual(['BSc Mathematics', 'MSc Computing', 'Diploma']);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(listEducation).toHaveBeenCalledTimes(1);
    expect(listEducation.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);

    const first = entryOf('BSc Mathematics');
    expect(within(first).getByText('College A')).toBeTruthy();
    expect(within(first).getByText('Applied Mathematics')).toBeTruthy();
    expect(within(first).getByText('2019 – 2023')).toBeTruthy();
    expect(first.querySelector('.education-entry__description')).not.toBeNull();
    expect(screen.queryByText(EDUCATION_EMPTY_MESSAGE)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows "Present" when there is no end year (28.3)', async () => {
    vi.mocked(listEducation).mockResolvedValue(EDUCATION);
    renderPage();
    await screen.findByText('MSc Computing');
    expect(within(entryOf('MSc Computing')).getByText('2021 – Present')).toBeTruthy();
  });

  it('omits an empty field of study and description but keeps the required fields (28.4)', async () => {
    vi.mocked(listEducation).mockResolvedValue(EDUCATION);
    renderPage();
    await screen.findByText('MSc Computing');

    for (const [qualification, institution, years] of [
      ['MSc Computing', 'University B', '2021 – Present'],
      ['Diploma', 'School C', '2010 – 2012'],
    ]) {
      const entry = entryOf(qualification);
      expect(entry.querySelector('.education-entry__field')).toBeNull();
      expect(entry.querySelector('.education-entry__description')).toBeNull();
      expect(entry.textContent).toBe(`${qualification}${institution}${years}`);
    }
  });

  it('renders the description as plain text with line breaks and literal HTML (28.5)', async () => {
    vi.mocked(listEducation).mockResolvedValue(EDUCATION);
    renderPage();
    await screen.findByText('BSc Mathematics');

    const description = entryOf('BSc Mathematics').querySelector('.education-entry__description');
    expect(description.textContent).toBe('First line\nSecond line <b>bold</b>');
    expect(description.className).toContain('pre-line');
    expect(description.querySelector('b')).toBeNull();
  });

  it('shows only a loading indicator while the request runs', async () => {
    let resolve;
    vi.mocked(listEducation).mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();

    expect(screen.getByRole('status').textContent).toMatch(/loading/i);
    expect(headingTexts(1)).toEqual(['Education']);
    expect(headingTexts(2)).toEqual([]);
    expect(screen.queryByText(EDUCATION_EMPTY_MESSAGE)).toBeNull();

    await act(async () => resolve(EDUCATION));
    expect(headingTexts(2)).toHaveLength(3);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the empty-state message and no entries for an empty list (28.6)', async () => {
    vi.mocked(listEducation).mockResolvedValue([]);
    renderPage();

    await screen.findByText(EDUCATION_EMPTY_MESSAGE);
    expect(EDUCATION_EMPTY_MESSAGE).toBe('No education entries are available.');
    expect(headingTexts(2)).toEqual([]);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error with a Retry button and never the empty state (28.7)', async () => {
    vi.mocked(listEducation)
      .mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Server exploded' }))
      .mockResolvedValueOnce(EDUCATION);
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Server exploded');
    expect(headingTexts(2)).toEqual([]);
    expect(screen.queryByText(EDUCATION_EMPTY_MESSAGE)).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { level: 2, name: 'BSc Mathematics' });
    expect(listEducation).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sets the document title to "Education | site_title"', async () => {
    vi.mocked(listEducation).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(document.title).toBe('Education | Ada Dev'));
  });
});
