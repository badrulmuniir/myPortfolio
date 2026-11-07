// Profile form page tests (Requirements 10.6, 10.7, 10.8, 10.11, 10.12, 31.13).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import * as profileApi from '../../api/profileApi.js';
import { NotificationProvider } from '../../context/NotificationContext.jsx';
import ProfileFormPage, {
  PROFILE_FIELD_ORDER,
  PROFILE_MISSING_TITLE,
  PROFILE_SAVED_MESSAGE,
  PROFILE_SAVING_LABEL,
  PROFILE_SUBMIT_LABEL,
} from './ProfileFormPage.jsx';

vi.mock('../../api/profileApi.js', () => ({
  get: vi.fn(),
  update: vi.fn(),
}));

const PROFILE = {
  name: 'Ada Lovelace',
  professional_title: 'Full-Stack Developer',
  personal_introduction: 'Hello there',
  biography: 'Line one\nLine two',
  career_interests: 'Compilers',
  professional_goals: 'Ship things',
  profile_image_url: 'https://cdn.example.com/ada.jpg',
  email: 'ada@example.com',
  github_url: 'https://github.com/ada',
  linkedin_url: '',
};

const LABELS = {
  name: 'Name',
  professional_title: 'Professional title',
  email: 'Email',
  personal_introduction: 'Personal introduction',
  biography: 'Biography',
  career_interests: 'Career interests',
  professional_goals: 'Professional goals',
  profile_image_url: 'Profile image URL',
  github_url: 'GitHub URL',
  linkedin_url: 'LinkedIn URL',
};

const renderPage = () =>
  render(
    <NotificationProvider>
      <MemoryRouter initialEntries={['/admin/profile']}>
        <ProfileFormPage />
      </MemoryRouter>
    </NotificationProvider>,
  );

const field = (name) => screen.getByLabelText(new RegExp(`^${LABELS[name]}`));
const submitButton = () => screen.getByRole('button', { name: new RegExp(`${PROFILE_SUBMIT_LABEL}|${PROFILE_SAVING_LABEL}`) });
const statusRegion = () => document.querySelector('.notification-region [role="status"]');
const alertTexts = () => screen.queryAllByRole('alert').map((el) => el.textContent);

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

afterEach(() => {
  vi.mocked(profileApi.get).mockReset();
  vi.mocked(profileApi.update).mockReset();
});

describe('ProfileFormPage', () => {
  it('fills all ten fields from GET /api/profile before showing an enabled submit button (10.11)', async () => {
    const load = deferred();
    vi.mocked(profileApi.get).mockReturnValue(load.promise);
    renderPage();

    expect(screen.queryByRole('button', { name: PROFILE_SUBMIT_LABEL })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();

    load.resolve(PROFILE);
    const button = await screen.findByRole('button', { name: PROFILE_SUBMIT_LABEL });
    expect(button.disabled).toBe(false);
    for (const name of PROFILE_FIELD_ORDER) expect(field(name).value).toBe(PROFILE[name]);
    expect(document.title).toBe('Profile | Admin');
    expect(profileApi.get).toHaveBeenCalledTimes(1);
  });

  it('sends all ten trimmed fields with the button disabled, then shows success and the returned values (10.6, 10.7)', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(PROFILE);
    const save = deferred();
    vi.mocked(profileApi.update).mockReturnValue(save.promise);
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('button', { name: PROFILE_SUBMIT_LABEL });
    await user.clear(field('professional_title'));
    await user.type(field('professional_title'), '  Backend Developer  ');
    await user.click(submitButton());

    expect(profileApi.update).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(profileApi.update).mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual([...PROFILE_FIELD_ORDER].sort());
    expect(payload).toEqual({ ...PROFILE, professional_title: 'Backend Developer' });

    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toBe(PROFILE_SAVING_LABEL);
    await user.click(submitButton());
    expect(profileApi.update).toHaveBeenCalledTimes(1);

    save.resolve({ ...PROFILE, professional_title: 'Backend Developer', linkedin_url: 'https://linkedin.com/in/ada' });
    await waitFor(() => expect(within(statusRegion()).getByText(PROFILE_SAVED_MESSAGE)).toBeTruthy());
    expect(field('professional_title').value).toBe('Backend Developer');
    expect(field('linkedin_url').value).toBe('https://linkedin.com/in/ada');
    expect(submitButton().disabled).toBe(false);
  });

  it('shows an error Notification and server field errors and keeps the entered values (10.8)', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(PROFILE);
    vi.mocked(profileApi.update).mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [{ field: 'github_url', reason: 'invalid_url', message: 'GitHub URL is not allowed' }],
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('button', { name: PROFILE_SUBMIT_LABEL });
    await user.clear(field('name'));
    await user.type(field('name'), 'Ada King');
    await user.click(submitButton());

    expect(await screen.findByText('GitHub URL is not allowed')).toBeTruthy();
    expect(field('github_url').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('github_url'));
    expect(alertTexts().some((text) => text.includes('Request validation failed'))).toBe(true);
    expect(field('name').value).toBe('Ada King');
    expect(submitButton().disabled).toBe(false);
  });

  it('shows an error Notification and keeps the values when the request fails to reach the server (10.8)', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(PROFILE);
    vi.mocked(profileApi.update).mockRejectedValue(
      new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('button', { name: PROFILE_SUBMIT_LABEL });
    await user.type(field('career_interests'), ' and tools');
    await user.click(submitButton());

    await waitFor(() => expect(alertTexts().some((text) => text.includes(NETWORK_ERROR_MESSAGE))).toBe(true));
    expect(field('career_interests').value).toBe('Compilers and tools');
    expect(submitButton().disabled).toBe(false);
  });

  it('sends no request and focuses the first invalid field when client validation fails', async () => {
    vi.mocked(profileApi.get).mockResolvedValue(PROFILE);
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('button', { name: PROFILE_SUBMIT_LABEL });
    await user.clear(field('name'));
    await user.clear(field('email'));
    await user.type(field('email'), 'not-an-email');
    await user.click(submitButton());

    expect(profileApi.update).not.toHaveBeenCalled();
    expect(field('name').getAttribute('aria-invalid')).toBe('true');
    expect(field('email').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('name'));
  });

  it('explains a missing Profile row instead of showing the form, and Retry repeats the request (10.12)', async () => {
    vi.mocked(profileApi.get)
      .mockRejectedValueOnce(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Profile not found' }))
      .mockResolvedValueOnce(PROFILE);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(PROFILE_MISSING_TITLE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: PROFILE_SUBMIT_LABEL })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: PROFILE_SUBMIT_LABEL })).toBeTruthy();
    expect(field('name').value).toBe(PROFILE.name);
    expect(profileApi.get).toHaveBeenCalledTimes(2);
  });
});
