import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SiteDataProvider, useSiteData } from './SiteDataContext.jsx';
import { get as getSettings } from '../api/settingsApi.js';
import { get as getProfile } from '../api/profileApi.js';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../api/apiClient.js';

vi.mock('../api/settingsApi.js', () => ({ get: vi.fn() }));
vi.mock('../api/profileApi.js', () => ({ get: vi.fn() }));

const SETTINGS = {
  site_title: 'My Portfolio',
  hero_introduction: 'Hello',
  footer_text: 'Built with care',
  social_links: [],
};
const PROFILE = { name: 'Ada Lovelace', email: 'ada@example.com' };

function Consumer() {
  const { settings, profile, settingsState, profileState } = useSiteData();
  return (
    <div>
      <p data-testid="settings">
        {settingsState.loading ? 'settings loading' : settings ? settings.site_title : `settings error: ${settingsState.error.message}`}
      </p>
      <p data-testid="profile">
        {profileState.loading
          ? 'profile loading'
          : profile
            ? profile.name
            : `profile error ${profileState.error.status}: ${profileState.error.message}`}
      </p>
      <button type="button" onClick={profileState.retry}>
        Retry profile
      </button>
    </div>
  );
}

const renderWithProvider = () =>
  render(
    <SiteDataProvider>
      <Consumer />
    </SiteDataProvider>,
  );

afterEach(() => {
  vi.mocked(getSettings).mockReset();
  vi.mocked(getProfile).mockReset();
});

describe('SiteDataProvider', () => {
  it('fetches settings and profile once each and exposes the data', async () => {
    vi.mocked(getSettings).mockResolvedValue(SETTINGS);
    vi.mocked(getProfile).mockResolvedValue(PROFILE);
    renderWithProvider();

    expect(screen.getByTestId('settings').textContent).toBe('settings loading');
    expect(screen.getByTestId('profile').textContent).toBe('profile loading');

    expect(await screen.findByText('My Portfolio')).toBeTruthy();
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(getSettings.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('exposes a profile 404 as an error while settings stay available', async () => {
    vi.mocked(getSettings).mockResolvedValue(SETTINGS);
    vi.mocked(getProfile).mockRejectedValue(
      new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Profile not found' }),
    );
    renderWithProvider();

    expect(await screen.findByText('profile error 404: Profile not found')).toBeTruthy();
    expect(screen.getByTestId('settings').textContent).toBe('My Portfolio');
  });

  it('repeats the failed request on retry and shows the new data', async () => {
    vi.mocked(getSettings).mockResolvedValue(SETTINGS);
    vi.mocked(getProfile)
      .mockRejectedValueOnce(
        new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }),
      )
      .mockResolvedValueOnce(PROFILE);
    renderWithProvider();

    expect(await screen.findByText(`profile error 0: ${NETWORK_ERROR_MESSAGE}`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry profile' }));
    expect(screen.getByTestId('profile').textContent).toBe('profile loading');
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect(getSettings).toHaveBeenCalledTimes(1);
  });

  it('exposes a settings failure without blocking the profile', async () => {
    vi.mocked(getSettings).mockRejectedValue(
      new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }),
    );
    vi.mocked(getProfile).mockResolvedValue(PROFILE);
    renderWithProvider();

    expect(await screen.findByText('settings error: An unexpected error occurred')).toBeTruthy();
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
  });
});

describe('useSiteData', () => {
  it('throws a clear error outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Consumer />)).toThrow(/inside a <SiteDataProvider>/);
    } finally {
      spy.mockRestore();
    }
  });
});
