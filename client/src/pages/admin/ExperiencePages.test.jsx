import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import * as experiencesApi from '../../api/experiencesApi.js';
import { NotificationProvider } from '../../context/NotificationContext.jsx';
import ExperienceListPage, {
  EXPERIENCE_DELETED_MESSAGE,
  EXPERIENCE_EMPTY_MESSAGE,
} from './ExperienceListPage.jsx';
import ExperienceFormPage, {
  END_BEFORE_START_MESSAGE,
  EXPERIENCE_CREATED_MESSAGE,
  EXPERIENCE_NOT_FOUND_MESSAGE,
  EXPERIENCE_UPDATED_MESSAGE,
  checkExperienceForm,
} from './ExperienceFormPage.jsx';

vi.mock('../../api/experiencesApi.js', () => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

const api = vi.mocked(experiencesApi);

const RECORDS = [
  {
    id: 7,
    job_title: 'Senior Developer',
    company_name: 'Acme',
    employment_type: 'Full-time',
    start_date: '2023-02-01',
    end_date: null,
    description: 'Builds things',
    responsibilities: ['Lead the team', 'Review code'],
  },
  {
    id: 3,
    job_title: 'Intern',
    company_name: 'Initech',
    employment_type: 'Internship',
    start_date: '2020-06-15',
    end_date: '2020-09-30',
    description: '',
    responsibilities: [],
  },
];

function Path() {
  const location = useLocation();
  return <p data-testid="path">{location.pathname}</p>;
}

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NotificationProvider>
        <Path />
        <Routes>
          <Route path="/admin/experience" element={<ExperienceListPage />} />
          <Route path="/admin/experience/new" element={<ExperienceFormPage />} />
          <Route path="/admin/experience/:id/edit" element={<ExperienceFormPage />} />
        </Routes>
      </NotificationProvider>
    </MemoryRouter>,
  );
}

const path = () => screen.getByTestId('path').textContent;
// The NotificationRegion's live regions (a LoadingIndicator also has role="status").
const status = () => document.querySelector('.notification-region [role="status"]');
const alertRegion = () => document.querySelector('.notification-region [role="alert"]');

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('ExperienceListPage', () => {
  it('shows one row per record with Edit and Delete actions named after the job title (31.3)', async () => {
    api.list.mockResolvedValue(RECORDS);
    renderAt('/admin/experience');

    const table = await screen.findByRole('table');
    expect(document.title).toBe('Experience | Admin');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('rowheader').textContent).toBe('Senior Developer');
    expect(rows[0].textContent).toContain('Feb 2023 – Present');
    expect(rows[1].textContent).toContain('Jun 2020 – Sep 2020');
    expect(screen.getByRole('link', { name: 'Edit Senior Developer' }).getAttribute('href')).toBe(
      '/admin/experience/7/edit',
    );
    expect(screen.getByRole('button', { name: 'Delete Intern' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add experience' }).getAttribute('href')).toBe('/admin/experience/new');
  });

  it('shows an empty state, and an error with Retry that repeats the request (31.14)', async () => {
    api.list.mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL', message: 'Boom' }));
    api.list.mockResolvedValueOnce([]);
    renderAt('/admin/experience');

    expect(await screen.findByText('Boom')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(EXPERIENCE_EMPTY_MESSAGE)).toBeTruthy();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('sends no delete request on Cancel, deletes on Confirm and reloads the list (31.5, 31.11)', async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValueOnce(RECORDS).mockResolvedValueOnce([RECORDS[0]]);
    api.remove.mockResolvedValue({ id: 3 });
    renderAt('/admin/experience');

    await user.click(await screen.findByRole('button', { name: 'Delete Intern' }));
    let dialog = screen.getByRole('dialog', { name: 'Delete experience entry?' });
    expect(dialog.textContent).toContain('Intern');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete Intern' }));
    dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(api.remove).toHaveBeenCalledWith(3);
    await waitFor(() => expect(within(status()).getByText(EXPERIENCE_DELETED_MESSAGE)).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Intern' })).toBeNull());
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('shows an error Notification and keeps the list when a delete fails (31.16)', async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue(RECORDS);
    api.remove.mockRejectedValue(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }));
    renderAt('/admin/experience');

    await user.click(await screen.findByRole('button', { name: 'Delete Intern' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(within(alertRegion()).getByText(NETWORK_ERROR_MESSAGE)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Delete Intern' })).toBeTruthy();
    expect(api.list).toHaveBeenCalledTimes(1);
  });
});

describe('checkExperienceForm', () => {
  const valid = {
    job_title: ' Dev ',
    company_name: 'Acme',
    employment_type: 'Contract',
    start_date: '2024-03-01',
    end_date: '',
    description: '',
    responsibilities: ['  Ship  '],
  };

  it('returns a trimmed payload with every field and end_date null for a current role', () => {
    expect(checkExperienceForm(valid)).toEqual({
      valid: true,
      payload: {
        job_title: 'Dev',
        company_name: 'Acme',
        employment_type: 'Contract',
        start_date: '2024-03-01',
        end_date: null,
        description: '',
        responsibilities: ['Ship'],
      },
    });
  });

  it('accepts an end date equal to the start date and rejects an earlier one (16.4)', () => {
    expect(checkExperienceForm({ ...valid, end_date: '2024-03-01' }).valid).toBe(true);
    expect(checkExperienceForm({ ...valid, end_date: '2024-02-29' })).toEqual({
      valid: false,
      errors: { end_date: END_BEFORE_START_MESSAGE },
    });
  });

  it('reports the end date error together with other failing fields', () => {
    const result = checkExperienceForm({ ...valid, job_title: '  ', end_date: '2023-01-01' });
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(['end_date', 'job_title']);
  });
});

describe('ExperienceFormPage', () => {
  it('shows field errors next to each failing field and sends no request (31.7)', async () => {
    const user = userEvent.setup();
    renderAt('/admin/experience/new');
    expect(document.title).toBe('New experience entry | Admin');

    fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: '2024-05-10' } });
    fireEvent.change(screen.getByLabelText(/^End date/), { target: { value: '2024-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Add responsibility' }));
    await user.click(screen.getByRole('button', { name: 'Create experience entry' }));

    const jobTitle = screen.getByLabelText(/^Job title/);
    expect(jobTitle.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(jobTitle);
    expect(screen.getByLabelText(/^Company/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/^Employment type/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(END_BEFORE_START_MESSAGE)).toBeTruthy();
    expect(screen.getByLabelText('Responsibility 1').getAttribute('aria-invalid')).toBe('true');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('creates a record with responsibilities in the order shown, then returns to the list (31.9, 31.11)', async () => {
    const user = userEvent.setup();
    api.create.mockResolvedValue({ id: 9 });
    api.list.mockResolvedValue([]);
    renderAt('/admin/experience/new');

    await user.type(screen.getByLabelText(/^Job title/), 'Engineer');
    await user.type(screen.getByLabelText(/^Company/), 'Globex');
    await user.selectOptions(screen.getByLabelText(/^Employment type/), 'Part-time');
    fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: '2022-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Add responsibility' }));
    await user.type(screen.getByLabelText('Responsibility 1'), 'First');
    await user.click(screen.getByRole('button', { name: 'Add responsibility' }));
    await user.type(screen.getByLabelText('Responsibility 2'), 'Second');
    await user.click(screen.getByRole('button', { name: 'Move up Responsibility 2' }));
    await user.click(screen.getByRole('button', { name: 'Create experience entry' }));

    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create).toHaveBeenCalledWith({
      job_title: 'Engineer',
      company_name: 'Globex',
      employment_type: 'Part-time',
      start_date: '2022-01-01',
      end_date: null,
      description: '',
      responsibilities: ['Second', 'First'],
    });
    await waitFor(() => expect(path()).toBe('/admin/experience'));
    expect(within(status()).getByText(EXPERIENCE_CREATED_MESSAGE)).toBeTruthy();
    expect(api.list).toHaveBeenCalled();
  });

  it('pre-fills the edit form from the list and sends PUT with the record id', async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue(RECORDS);
    api.update.mockResolvedValue(RECORDS[0]);
    renderAt('/admin/experience/7/edit');

    const jobTitle = await screen.findByLabelText(/^Job title/);
    expect(document.title).toBe('Edit experience entry | Admin');
    expect(jobTitle.value).toBe('Senior Developer');
    expect(screen.getByLabelText(/^Employment type/).value).toBe('Full-time');
    expect(screen.getByLabelText(/^End date/).value).toBe('');
    expect(screen.getByLabelText('Responsibility 2').value).toBe('Review code');

    await user.click(screen.getByRole('button', { name: 'Remove Responsibility 1' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(api.update).toHaveBeenCalledWith(7, {
      job_title: 'Senior Developer',
      company_name: 'Acme',
      employment_type: 'Full-time',
      start_date: '2023-02-01',
      end_date: null,
      description: 'Builds things',
      responsibilities: ['Review code'],
    });
    await waitFor(() => expect(path()).toBe('/admin/experience'));
    expect(within(status()).getByText(EXPERIENCE_UPDATED_MESSAGE)).toBeTruthy();
  });

  it('shows a not-found state for an id that matches no record', async () => {
    api.list.mockResolvedValue(RECORDS);
    renderAt('/admin/experience/999/edit');
    expect(await screen.findByText(EXPERIENCE_NOT_FOUND_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('shows server field errors next to the fields and keeps the values (31.15)', async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue(RECORDS);
    api.update.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: [{ field: 'responsibilities[1]', reason: 'too_long', message: 'Must be at most 300 characters' }],
      }),
    );
    renderAt('/admin/experience/7/edit');

    await user.click(await screen.findByRole('button', { name: 'Save changes' }));

    const item = await screen.findByText('Must be at most 300 characters');
    expect(screen.getByLabelText('Responsibility 2').getAttribute('aria-invalid')).toBe('true');
    expect(item).toBeTruthy();
    expect(screen.getByLabelText(/^Job title/).value).toBe('Senior Developer');
    expect(path()).toBe('/admin/experience/7/edit');
  });

  it('shows an error Notification and keeps the form when the save cannot reach the server (31.16)', async () => {
    const user = userEvent.setup();
    api.create.mockRejectedValue(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }));
    renderAt('/admin/experience/new');

    await user.type(screen.getByLabelText(/^Job title/), 'Engineer');
    await user.type(screen.getByLabelText(/^Company/), 'Globex');
    await user.selectOptions(screen.getByLabelText(/^Employment type/), 'Freelance');
    fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: '2022-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Create experience entry' }));

    await waitFor(() => expect(within(alertRegion()).getByText(NETWORK_ERROR_MESSAGE)).toBeTruthy());
    expect(screen.getByLabelText(/^Job title/).value).toBe('Engineer');
    expect(screen.getByRole('button', { name: 'Create experience entry' }).disabled).toBe(false);
    expect(path()).toBe('/admin/experience/new');
  });
});
