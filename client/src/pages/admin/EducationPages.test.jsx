// Education management page tests (Requirements 17.3, 17.4, 31.3, 31.5, 31.7, 31.11, 31.15, 31.16).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import * as educationApi from '../../api/educationApi.js';
import { NotificationProvider } from '../../context/NotificationContext.jsx';
import EducationListPage, { EDUCATION_EMPTY_MESSAGE } from './EducationListPage.jsx';
import EducationFormPage, { EDUCATION_NOT_FOUND_HEADING } from './EducationFormPage.jsx';

vi.mock('../../api/educationApi.js', () => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

const RECORDS = [
  {
    id: 2,
    institution: 'State University',
    qualification: 'MSc Software Engineering',
    field_of_study: 'Software Engineering',
    start_year: 2021,
    end_year: null,
    description: 'Ongoing',
  },
  {
    id: 1,
    institution: 'City College',
    qualification: 'BSc Computer Science',
    field_of_study: '',
    start_year: 2016,
    end_year: 2020,
    description: '',
  },
];

const MAX_YEAR = new Date().getUTCFullYear() + 10;

const renderAt = (path) =>
  render(
    <NotificationProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/education" element={<EducationListPage />} />
          <Route path="/admin/education/new" element={<EducationFormPage />} />
          <Route path="/admin/education/:id/edit" element={<EducationFormPage />} />
        </Routes>
      </MemoryRouter>
    </NotificationProvider>,
  );

const field = (label) => screen.getByLabelText(new RegExp(`^${label}`));
// The success live region of the NotificationProvider (LoadingIndicator also uses role="status").
const statusRegion = () => document.querySelector('.notification-region [role="status"]');

afterEach(() => {
  Object.values(educationApi).forEach((fn) => vi.mocked(fn).mockReset());
});

describe('EducationListPage', () => {
  it('shows one row per record with years and named Edit and Delete actions (31.3)', async () => {
    vi.mocked(educationApi.list).mockResolvedValue(RECORDS);
    renderAt('/admin/education');

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('2021 – Present');
    expect(rows[1].textContent).toContain('2016 – 2020');
    expect(screen.getByRole('link', { name: 'Edit BSc Computer Science' }).getAttribute('href')).toBe(
      '/admin/education/1/edit',
    );
    expect(screen.getByRole('button', { name: 'Delete MSc Software Engineering' })).toBeTruthy();
    expect(document.title).toBe('Education | Admin');
  });

  it('shows an empty state naming the content type', async () => {
    vi.mocked(educationApi.list).mockResolvedValue([]);
    renderAt('/admin/education');
    expect(await screen.findByText(EDUCATION_EMPTY_MESSAGE)).toBeTruthy();
  });

  it('sends no request when the delete dialog is cancelled (31.5)', async () => {
    vi.mocked(educationApi.list).mockResolvedValue(RECORDS);
    const user = userEvent.setup();
    renderAt('/admin/education');

    await user.click(await screen.findByRole('button', { name: 'Delete BSc Computer Science' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete education record?' });
    expect(dialog.textContent).toContain('"BSc Computer Science" at City College');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(educationApi.remove).not.toHaveBeenCalled();
  });

  it('deletes on Confirm, shows a success Notification and reloads the list (31.11)', async () => {
    vi.mocked(educationApi.list).mockResolvedValueOnce(RECORDS).mockResolvedValueOnce([RECORDS[0]]);
    vi.mocked(educationApi.remove).mockResolvedValue({ id: 1 });
    const user = userEvent.setup();
    renderAt('/admin/education');

    await user.click(await screen.findByRole('button', { name: 'Delete BSc Computer Science' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    expect(educationApi.remove).toHaveBeenCalledWith(1);
    await waitFor(() => expect(within(statusRegion()).getByText(/Deleted education record/)).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete BSc Computer Science' })).toBeNull());
    expect(educationApi.list).toHaveBeenCalledTimes(2);
  });

  it('shows an error Notification and keeps the list when the delete fails (31.16)', async () => {
    vi.mocked(educationApi.list).mockResolvedValue(RECORDS);
    vi.mocked(educationApi.remove).mockRejectedValue(
      new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }),
    );
    const user = userEvent.setup();
    renderAt('/admin/education');

    await user.click(await screen.findByRole('button', { name: 'Delete BSc Computer Science' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((el) => el.textContent.includes(NETWORK_ERROR_MESSAGE))).toBe(true);
    expect(screen.getByRole('button', { name: 'Delete BSc Computer Science' })).toBeTruthy();
    expect(educationApi.list).toHaveBeenCalledTimes(1);
  });
});

describe('EducationFormPage', () => {
  it('sends no request and shows field errors for an empty form (31.7)', async () => {
    const user = userEvent.setup();
    renderAt('/admin/education/new');

    await user.click(screen.getByRole('button', { name: 'Create education record' }));

    expect(educationApi.create).not.toHaveBeenCalled();
    for (const label of ['Institution', 'Qualification', 'Start year']) {
      expect(field(label).getAttribute('aria-invalid')).toBe('true');
    }
    expect(document.activeElement).toBe(field('Institution'));
    expect(field('End year').getAttribute('aria-invalid')).toBeNull();
  });

  it.each([
    ['before the start year', '2019', 'End year must not be before the start year'],
    ['after the current year plus 10', String(MAX_YEAR + 1), `Must be between 1950 and ${MAX_YEAR}`],
    ['not a whole number', '2020.5', 'Must be a whole number'],
  ])('rejects an end year %s without sending a request (17.3, 17.4)', async (_label, endYear, message) => {
    const user = userEvent.setup();
    renderAt('/admin/education/new');

    await user.type(field('Institution'), 'City College');
    await user.type(field('Qualification'), 'BSc');
    await user.type(field('Start year'), '2020');
    await user.type(field('End year'), endYear);
    await user.click(screen.getByRole('button', { name: 'Create education record' }));

    expect(educationApi.create).not.toHaveBeenCalled();
    expect(field('End year').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(message)).toBeTruthy();
  });

  it('creates a record with trimmed values and a null end year, then returns to the list (31.11)', async () => {
    vi.mocked(educationApi.create).mockResolvedValue({ id: 3, qualification: 'BSc' });
    vi.mocked(educationApi.list).mockResolvedValue(RECORDS);
    const user = userEvent.setup();
    renderAt('/admin/education/new');

    await user.type(field('Institution'), '  City College ');
    await user.type(field('Qualification'), 'BSc');
    await user.type(field('Start year'), '2020');
    await user.click(screen.getByRole('button', { name: 'Create education record' }));

    expect(educationApi.create).toHaveBeenCalledWith({
      institution: 'City College',
      qualification: 'BSc',
      field_of_study: '',
      start_year: 2020,
      end_year: null,
      description: '',
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Education' })).toBeTruthy();
    expect(within(statusRegion()).getByText('Created education record "BSc".')).toBeTruthy();
  });

  it('pre-fills the edit form and sends every field with PUT (31.3)', async () => {
    vi.mocked(educationApi.list).mockResolvedValue(RECORDS);
    vi.mocked(educationApi.update).mockResolvedValue({ ...RECORDS[1], end_year: 2021 });
    const user = userEvent.setup();
    renderAt('/admin/education/1/edit');

    expect(await screen.findByDisplayValue('BSc Computer Science')).toBeTruthy();
    expect(field('Start year').value).toBe('2016');
    expect(field('End year').value).toBe('2020');

    await user.clear(field('End year'));
    await user.type(field('End year'), '2021');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(educationApi.update).toHaveBeenCalledWith(1, {
      institution: 'City College',
      qualification: 'BSc Computer Science',
      field_of_study: '',
      start_year: 2016,
      end_year: 2021,
      description: '',
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Education' })).toBeTruthy();
  });

  it('shows a not-found state for an id that matches no record', async () => {
    vi.mocked(educationApi.list).mockResolvedValue(RECORDS);
    renderAt('/admin/education/99/edit');

    expect(await screen.findByRole('heading', { level: 1, name: EDUCATION_NOT_FOUND_HEADING })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to education records' }).getAttribute('href')).toBe(
      '/admin/education',
    );
  });

  it('shows server field errors next to the fields and keeps the values (31.15)', async () => {
    vi.mocked(educationApi.list).mockResolvedValue(RECORDS);
    vi.mocked(educationApi.update).mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'end_year', reason: 'out_of_range', message: 'End year is out of range' }],
      }),
    );
    const user = userEvent.setup();
    renderAt('/admin/education/2/edit');

    await screen.findByDisplayValue('MSc Software Engineering');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('End year is out of range')).toBeTruthy();
    expect(field('End year').getAttribute('aria-invalid')).toBe('true');
    expect(field('Qualification').value).toBe('MSc Software Engineering');
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(false);
  });

  it('shows an error Notification and keeps the form when saving fails (31.16)', async () => {
    vi.mocked(educationApi.create).mockRejectedValue(
      new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' }),
    );
    const user = userEvent.setup();
    renderAt('/admin/education/new');

    await user.type(field('Institution'), 'City College');
    await user.type(field('Qualification'), 'BSc');
    await user.type(field('Start year'), '2020');
    await user.click(screen.getByRole('button', { name: 'Create education record' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((el) => el.textContent.includes('Something went wrong'))).toBe(true);
    expect(field('Institution').value).toBe('City College');
  });
});
