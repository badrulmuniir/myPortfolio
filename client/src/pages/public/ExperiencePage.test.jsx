import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExperiencePage, { EXPERIENCE_EMPTY_MESSAGE } from './ExperiencePage.jsx';
import { SiteDataProvider } from '../../context/SiteDataContext.jsx';
import { list as listExperiences } from '../../api/experiencesApi.js';
import { get as getSettings } from '../../api/settingsApi.js';
import { get as getProfile } from '../../api/profileApi.js';
import { ApiError } from '../../api/apiClient.js';

vi.mock('../../api/experiencesApi.js', () => ({ list: vi.fn() }));
vi.mock('../../api/settingsApi.js', () => ({ get: vi.fn() }));
vi.mock('../../api/profileApi.js', () => ({ get: vi.fn() }));

const SETTINGS = { site_title: 'Ada Dev', hero_introduction: '', footer_text: '', social_links: [] };

// Deliberately not in date order: the page must keep the API order (27.1).
const EXPERIENCES = [
  {
    id: 7,
    job_title: 'Senior Engineer',
    company_name: 'Acme Corp',
    employment_type: 'Full-time',
    start_date: '2024-01-15',
    end_date: null,
    description: 'Leads the platform team.\nOwns the build pipeline.',
    responsibilities: ['Design APIs', 'Mentor juniors', 'Review code'],
  },
  {
    id: 3,
    job_title: 'Intern',
    company_name: 'Globex',
    employment_type: 'Internship',
    start_date: '2019-06-01',
    end_date: '2019-08-31',
    description: '',
    responsibilities: [],
  },
  {
    id: 5,
    job_title: 'Contractor',
    company_name: 'Initech',
    employment_type: 'Contract',
    start_date: '2022-03-01',
    end_date: '2023-12-31',
    description: 'Short engagement.',
    responsibilities: ['Migrate database'],
  },
];

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/experience']}>
      <SiteDataProvider>
        <ExperiencePage />
      </SiteDataProvider>
    </MemoryRouter>,
  );

const headingTexts = (level) => screen.queryAllByRole('heading', { level }).map((h) => h.textContent);
const entryOf = (title) => screen.getByRole('article', { name: title });

beforeEach(() => {
  vi.mocked(getSettings).mockResolvedValue(SETTINGS);
  vi.mocked(getProfile).mockResolvedValue({ name: 'Ada' });
});

afterEach(() => {
  vi.mocked(listExperiences).mockReset();
  vi.mocked(getSettings).mockReset();
  vi.mocked(getProfile).mockReset();
});

describe('ExperiencePage', () => {
  it('shows one entry per record in API order with all fields (27.1, 27.3, 27.4)', async () => {
    vi.mocked(listExperiences).mockResolvedValue(EXPERIENCES);
    renderPage();

    await screen.findByRole('heading', { level: 2, name: 'Senior Engineer' });
    expect(headingTexts(1)).toEqual(['Experience']);
    expect(headingTexts(2)).toEqual(['Senior Engineer', 'Intern', 'Contractor']);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(listExperiences).toHaveBeenCalledTimes(1);
    expect(listExperiences.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);

    const senior = entryOf('Senior Engineer');
    expect(within(senior).getByText('Acme Corp')).toBeTruthy();
    expect(within(senior).getByText('Full-time')).toBeTruthy();
    expect(within(senior).getByText('Jan 2024 \u2013 Present')).toBeTruthy();
    const description = senior.querySelector('.experience-entry__description');
    expect(description.textContent).toBe('Leads the platform team.\nOwns the build pipeline.');
    expect(description.classList.contains('pre-line')).toBe(true);

    expect(within(entryOf('Intern')).getByText('Jun 2019 \u2013 Aug 2019')).toBeTruthy();
    expect(within(entryOf('Intern')).getByText('Internship')).toBeTruthy();
    expect(within(entryOf('Contractor')).getByText('Mar 2022 \u2013 Dec 2023')).toBeTruthy();
    expect(within(entryOf('Contractor')).getByText('Initech')).toBeTruthy();
    expect(screen.queryByText(EXPERIENCE_EMPTY_MESSAGE)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('lists responsibilities as one bullet per item in stored order (27.2)', async () => {
    vi.mocked(listExperiences).mockResolvedValue(EXPERIENCES);
    renderPage();
    await screen.findByText('Acme Corp');

    const items = within(entryOf('Senior Engineer'))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual(['Design APIs', 'Mentor juniors', 'Review code']);
    expect(within(entryOf('Contractor')).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Migrate database',
    ]);
  });

  it('omits the list and description when they are empty, with no placeholder (27.5, 27.6)', async () => {
    vi.mocked(listExperiences).mockResolvedValue([
      ...EXPERIENCES,
      {
        id: 9,
        job_title: 'Volunteer Dev',
        company_name: 'Charity',
        employment_type: 'Volunteer',
        start_date: '2020-02-01',
        end_date: '',
        description: '   ',
        responsibilities: undefined,
      },
    ]);
    renderPage();
    await screen.findByText('Globex');

    for (const title of ['Intern', 'Volunteer Dev']) {
      const entry = entryOf(title);
      expect(within(entry).queryByRole('list')).toBeNull();
      expect(within(entry).queryAllByRole('listitem')).toHaveLength(0);
      expect(entry.querySelector('.experience-entry__description')).toBeNull();
    }
    expect(entryOf('Intern').textContent).toBe('InternGlobexInternshipJun 2019 \u2013 Aug 2019');
    expect(within(entryOf('Volunteer Dev')).getByText('Feb 2020 \u2013 Present')).toBeTruthy();
  });

  it('renders HTML in text fields as literal characters (27.7)', async () => {
    vi.mocked(listExperiences).mockResolvedValue([
      {
        id: 1,
        job_title: '<b>Lead</b>',
        company_name: '<i>Evil</i> Inc',
        employment_type: 'Freelance',
        start_date: '2021-05-01',
        end_date: null,
        description: '<script>alert(1)</script>',
        responsibilities: ['<img src=x onerror=alert(1)>'],
      },
    ]);
    const { container } = renderPage();

    await screen.findByRole('heading', { level: 2, name: '<b>Lead</b>' });
    expect(screen.getByText('<i>Evil</i> Inc')).toBeTruthy();
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(container.querySelector('b, i, script, img')).toBeNull();
  });

  it('shows only a loading indicator while the request runs', async () => {
    let resolve;
    vi.mocked(listExperiences).mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();

    expect(screen.getByRole('status').textContent).toMatch(/loading/i);
    expect(headingTexts(1)).toEqual(['Experience']);
    expect(headingTexts(2)).toEqual([]);
    expect(screen.queryByText(EXPERIENCE_EMPTY_MESSAGE)).toBeNull();

    await act(async () => resolve(EXPERIENCES));
    expect(headingTexts(2)).toEqual(['Senior Engineer', 'Intern', 'Contractor']);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the empty-state message for a successful empty response (27.8)', async () => {
    vi.mocked(listExperiences).mockResolvedValue([]);
    renderPage();

    await screen.findByText(EXPERIENCE_EMPTY_MESSAGE);
    expect(headingTexts(1)).toEqual(['Experience']);
    expect(headingTexts(2)).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error with a Retry button and never the empty state on failure (27.8)', async () => {
    vi.mocked(listExperiences)
      .mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Server exploded' }))
      .mockResolvedValueOnce(EXPERIENCES);
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Server exploded');
    expect(headingTexts(2)).toEqual([]);
    expect(screen.queryByText(EXPERIENCE_EMPTY_MESSAGE)).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { level: 2, name: 'Senior Engineer' });
    expect(listExperiences).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sets the document title to "Experience | site_title"', async () => {
    vi.mocked(listExperiences).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(document.title).toBe('Experience | Ada Dev'));
  });
});
