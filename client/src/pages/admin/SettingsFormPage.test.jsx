// Settings form page tests (Requirements 11.4, 11.9, 31.13, 31.15, 31.16).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import * as settingsApi from '../../api/settingsApi.js';
import { NotificationProvider } from '../../context/NotificationContext.jsx';
import SettingsFormPage, {
  SETTINGS_INVALID_MESSAGE,
  SETTINGS_LOAD_ERROR_TITLE,
  SETTINGS_NO_CHANGES_MESSAGE,
  SETTINGS_SAVED_MESSAGE,
  changedSettings,
  toFormValues,
} from './SettingsFormPage.jsx';

vi.mock('../../api/settingsApi.js', () => ({
  get: vi.fn(),
  update: vi.fn(),
}));

const SETTINGS = {
  site_title: 'Jane Doe',
  hero_introduction: 'I build web apps.',
  footer_text: '© Jane',
  social_links: [
    { label: 'GitHub', url: 'https://github.com/jane' },
    { label: 'Blog', url: 'https://jane.dev' },
  ],
};

const renderPage = () =>
  render(
    <NotificationProvider>
      <MemoryRouter initialEntries={['/admin/settings']}>
        <SettingsFormPage />
      </MemoryRouter>
    </NotificationProvider>,
  );

const field = (label) => screen.getByLabelText(new RegExp(`^${label}`));
const saveButton = () => screen.getByRole('button', { name: 'Save settings' });
// The success live region of the NotificationProvider (LoadingIndicator also uses role="status").
const statusRegion = () => document.querySelector('.notification-region [role="status"]');
const alertTexts = async () => (await screen.findAllByRole('alert')).map((el) => el.textContent);

afterEach(() => {
  vi.mocked(settingsApi.get).mockReset();
  vi.mocked(settingsApi.update).mockReset();
});

describe('changedSettings', () => {
  it('returns only keys that differ after trimming, links without row keys', () => {
    const saved = toFormValues(SETTINGS);
    const values = { ...toFormValues(SETTINGS), site_title: ' Jane Doe ', footer_text: 'New footer' };
    expect(changedSettings(values, saved)).toEqual({ footer_text: 'New footer' });

    values.social_links = [...values.social_links].reverse();
    expect(changedSettings(values, saved).social_links).toEqual([SETTINGS.social_links[1], SETTINGS.social_links[0]]);
  });
});

describe('SettingsFormPage', () => {
  it('loads the saved settings into the form', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(SETTINGS);
    renderPage();

    expect(await screen.findByDisplayValue('Jane Doe')).toBeTruthy();
    expect(field('Hero introduction').value).toBe('I build web apps.');
    expect(field('Footer text').value).toBe('© Jane');
    expect(field('Link 1 Label').value).toBe('GitHub');
    expect(field('Link 2 URL').value).toBe('https://jane.dev');
    expect(document.title).toBe('Settings | Admin');
  });

  it('shows an error with Retry when loading fails', async () => {
    vi.mocked(settingsApi.get)
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }))
      .mockResolvedValueOnce(SETTINGS);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(SETTINGS_LOAD_ERROR_TITLE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByDisplayValue('Jane Doe')).toBeTruthy();
  });

  it('sends only the changed values and shows a success Notification (11.9)', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(SETTINGS);
    vi.mocked(settingsApi.update).mockResolvedValue({ ...SETTINGS, footer_text: 'Built with React' });
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue('Jane Doe');
    await user.clear(field('Footer text'));
    await user.type(field('Footer text'), '  Built with React ');
    await user.click(saveButton());

    expect(settingsApi.update).toHaveBeenCalledWith({ footer_text: 'Built with React' });
    await waitFor(() => expect(within(statusRegion()).getByText(SETTINGS_SAVED_MESSAGE)).toBeTruthy());
    expect(field('Footer text').value).toBe('  Built with React ');

    // The saved values are now the baseline: submitting again sends nothing.
    await user.click(saveButton());
    expect(settingsApi.update).toHaveBeenCalledTimes(1);
    expect(screen.getByText(SETTINGS_NO_CHANGES_MESSAGE)).toBeTruthy();
  });

  it('disables the submit button while saving (31.13)', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(SETTINGS);
    let resolve;
    vi.mocked(settingsApi.update).mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue('Jane Doe');
    await user.type(field('Site title'), '!');
    await user.click(saveButton());

    const busy = screen.getByRole('button', { name: 'Saving…' });
    expect(busy.disabled).toBe(true);
    resolve({ ...SETTINGS, site_title: 'Jane Doe!' });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(settingsApi.update).toHaveBeenCalledTimes(1);
  });

  it('adds, reorders and removes social links and sends them in the order shown', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(SETTINGS);
    vi.mocked(settingsApi.update).mockImplementation(async (body) => ({ ...SETTINGS, ...body }));
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue('Jane Doe');
    await user.click(screen.getByRole('button', { name: 'Add social link' }));
    expect(document.activeElement).toBe(field('Link 3 Label'));
    await user.type(field('Link 3 Label'), ' LinkedIn ');
    await user.type(field('Link 3 URL'), 'https://linkedin.com/in/jane');

    await user.click(screen.getByRole('button', { name: 'Move up Link 3' }));
    expect(field('Link 2 Label').value).toBe(' LinkedIn ');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move up Link 2' }));

    await user.click(screen.getByRole('button', { name: 'Remove Link 1' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Link 1' }));
    await user.click(saveButton());

    expect(settingsApi.update).toHaveBeenCalledWith({
      social_links: [
        { label: 'LinkedIn', url: 'https://linkedin.com/in/jane' },
        { label: 'Blog', url: 'https://jane.dev' },
      ],
    });
  });

  it('allows at most 10 social links (11.4)', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ ...SETTINGS, social_links: [] });
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue('Jane Doe');
    const add = screen.getByRole('button', { name: 'Add social link' });
    for (let i = 0; i < 10; i += 1) await user.click(add);

    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(add.disabled).toBe(true);
    expect(screen.getByText('10 of 10 used')).toBeTruthy();
  });

  it('checks the changed values before sending and focuses the first invalid field (11.4)', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(SETTINGS);
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue('Jane Doe');
    await user.clear(field('Site title'));
    await user.type(field('Site title'), '   ');
    await user.clear(field('Link 2 URL'));
    await user.type(field('Link 2 URL'), 'javascript:alert(1)');
    await user.click(saveButton());

    expect(settingsApi.update).not.toHaveBeenCalled();
    expect(field('Site title').getAttribute('aria-invalid')).toBe('true');
    expect(field('Link 2 URL').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Must be a valid http or https URL')).toBeTruthy();
    expect(document.activeElement).toBe(field('Site title'));
  });

  it('shows server field errors and an error Notification, keeping the values (11.9, 31.15)', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(SETTINGS);
    vi.mocked(settingsApi.update).mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'social_links[0].label', reason: 'too_long', message: 'Label is too long' }],
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue('Jane Doe');
    await user.type(field('Link 1 Label'), ' profile');
    await user.click(saveButton());

    expect(await screen.findByText('Label is too long')).toBeTruthy();
    expect(field('Link 1 Label').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('Link 1 Label'));
    expect((await alertTexts()).some((t) => t.includes(SETTINGS_INVALID_MESSAGE))).toBe(true);
    expect(field('Link 1 Label').value).toBe('GitHub profile');
  });

  it('shows an error Notification and keeps the values when saving fails (11.9, 31.16)', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(SETTINGS);
    vi.mocked(settingsApi.update).mockRejectedValue(
      new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue('Jane Doe');
    await user.clear(field('Hero introduction'));
    await user.type(field('Hero introduction'), 'Hello there');
    await user.click(saveButton());

    expect((await alertTexts()).some((t) => t.includes(NETWORK_ERROR_MESSAGE))).toBe(true);
    expect(field('Hero introduction').value).toBe('Hello there');
    expect(saveButton().disabled).toBe(false);
  });
});
