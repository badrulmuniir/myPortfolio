import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HomePage from './HomePage.jsx';
import { SiteDataProvider } from '../../context/SiteDataContext.jsx';
import { get as getSettings } from '../../api/settingsApi.js';
import { get as getProfile } from '../../api/profileApi.js';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import { PLACEHOLDER_PROFILE } from '../../assets/placeholders.js';

vi.mock('../../api/settingsApi.js', () => ({ get: vi.fn() }));
vi.mock('../../api/profileApi.js', () => ({ get: vi.fn() }));

const SETTINGS = {
  site_title: 'Ada Codes',
  hero_introduction: 'I build reliable software.\nI enjoy hard problems.',
  footer_text: '',
  social_links: [],
};
const PROFILE = {
  name: 'Ada Lovelace',
  professional_title: 'Full-Stack Developer',
  profile_image_url: 'https://cdn.example.com/ada.jpg',
  github_url: 'https://github.com/ada',
  linkedin_url: 'https://www.linkedin.com/in/ada',
};

const networkError = () => new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE });

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SiteDataProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/projects" element={<p>Projects route</p>} />
          <Route path="/contact" element={<p>Contact route</p>} />
        </Routes>
      </SiteDataProvider>
    </MemoryRouter>,
  );
}

const headings1 = (container) => container.querySelectorAll('h1');

afterEach(() => {
  vi.mocked(getSettings).mockReset();
  vi.mocked(getProfile).mockReset();
});

describe('HomePage', () => {
  it('shows the name as the only h1, the title, the full intro, the image and the title bar', async () => {
    vi.mocked(getSettings).mockResolvedValue(SETTINGS);
    vi.mocked(getProfile).mockResolvedValue(PROFILE);
    const { container } = renderHome();

    const h1 = await screen.findByRole('heading', { level: 1, name: 'Ada Lovelace' });
    expect(headings1(container).length).toBe(1);
    expect(h1.textContent).toBe('Ada Lovelace');
    expect(screen.getByText('Full-Stack Developer')).toBeTruthy();

    const intro = container.querySelector('.home-hero__intro');
    expect(intro.textContent).toBe(SETTINGS.hero_introduction);

    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe(PROFILE.profile_image_url);
    expect(img.getAttribute('alt')).toContain('Ada Lovelace');

    await waitFor(() => expect(document.title).toBe('Home | Ada Codes'));
    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(getProfile).toHaveBeenCalledTimes(1);
  });

  it('shows the profile placeholder with the name as alt text when the image URL is empty or fails', async () => {
    vi.mocked(getSettings).mockResolvedValue(SETTINGS);
    vi.mocked(getProfile).mockResolvedValue({ ...PROFILE, profile_image_url: '' });
    const { unmount } = renderHome();

    let img = await screen.findByRole('img');
    expect(img.getAttribute('src')).toBe(PLACEHOLDER_PROFILE);
    expect(img.getAttribute('alt')).toContain('Ada Lovelace');
    unmount();

    vi.mocked(getProfile).mockResolvedValue(PROFILE);
    renderHome();
    img = await screen.findByRole('img');
    expect(img.getAttribute('src')).toBe(PROFILE.profile_image_url);
    fireEvent.error(img);
    expect(img.getAttribute('src')).toBe(PLACEHOLDER_PROFILE);
    expect(img.getAttribute('alt')).toContain('Ada Lovelace');
  });

  it('renders GitHub and LinkedIn links that open in a new tab', async () => {
    vi.mocked(getSettings).mockResolvedValue(SETTINGS);
    vi.mocked(getProfile).mockResolvedValue(PROFILE);
    renderHome();

    const github = await screen.findByRole('link', { name: 'GitHub' });
    const linkedin = screen.getByRole('link', { name: 'LinkedIn' });
    expect(github.getAttribute('href')).toBe(PROFILE.github_url);
    expect(linkedin.getAttribute('href')).toBe(PROFILE.linkedin_url);
    for (const link of [github, linkedin]) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('omits empty social links and an empty hero introduction', async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...SETTINGS, hero_introduction: '' });
    vi.mocked(getProfile).mockResolvedValue({ ...PROFILE, github_url: '', linkedin_url: '' });
    const { container } = renderHome();

    await screen.findByRole('heading', { level: 1, name: 'Ada Lovelace' });
    expect(screen.getByText('Full-Stack Developer')).toBeTruthy();
    expect(container.querySelector('.home-hero__intro')).toBeNull();
    expect(container.querySelector('.home-hero__social')).toBeNull();
    expect(screen.queryByText('GitHub')).toBeNull();
    expect(screen.queryByText('LinkedIn')).toBeNull();
  });

  it('navigates in the same tab with the View Projects and Contact Me buttons', async () => {
    vi.mocked(getSettings).mockResolvedValue(SETTINGS);
    vi.mocked(getProfile).mockResolvedValue(PROFILE);
    const { unmount } = renderHome();

    const viewProjects = await screen.findByRole('link', { name: 'View Projects' });
    expect(viewProjects.getAttribute('href')).toBe('/projects');
    expect(viewProjects.getAttribute('target')).toBeNull();
    fireEvent.click(viewProjects);
    expect(screen.getByText('Projects route')).toBeTruthy();
    unmount();

    renderHome();
    const contact = await screen.findByRole('link', { name: 'Contact Me' });
    expect(contact.getAttribute('href')).toBe('/contact');
    expect(contact.getAttribute('target')).toBeNull();
    fireEvent.click(contact);
    expect(screen.getByText('Contact route')).toBeTruthy();
  });

  it('shows a loading state with one h1 and the buttons while data loads', () => {
    vi.mocked(getSettings).mockReturnValue(new Promise(() => {}));
    vi.mocked(getProfile).mockReturnValue(new Promise(() => {}));
    const { container } = renderHome();

    expect(screen.getByRole('status')).toBeTruthy();
    expect(headings1(container).length).toBe(1);
    expect(screen.getByRole('link', { name: 'View Projects' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contact Me' })).toBeTruthy();
  });

  it('shows an error with Retry that repeats only the failed request, keeping the buttons', async () => {
    vi.mocked(getSettings).mockResolvedValue(SETTINGS);
    vi.mocked(getProfile).mockRejectedValueOnce(networkError()).mockResolvedValueOnce(PROFILE);
    const { container } = renderHome();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(NETWORK_ERROR_MESSAGE);
    expect(headings1(container).length).toBe(1);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'View Projects' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contact Me' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeTruthy();
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect(getSettings).toHaveBeenCalledTimes(1);
  });

  it('retries both requests when both fail', async () => {
    vi.mocked(getSettings).mockRejectedValueOnce(networkError()).mockResolvedValueOnce(SETTINGS);
    vi.mocked(getProfile).mockRejectedValueOnce(networkError()).mockResolvedValueOnce(PROFILE);
    renderHome();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeTruthy();
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect(getSettings).toHaveBeenCalledTimes(2);
  });

  it('renders a long hero introduction with markup in full as plain text', async () => {
    const text = `${'Long introduction. '.repeat(60)}<b>bold</b><script>alert(1)</script>`;
    vi.mocked(getSettings).mockResolvedValue({ ...SETTINGS, hero_introduction: text });
    vi.mocked(getProfile).mockResolvedValue(PROFILE);
    const { container } = renderHome();

    await screen.findByRole('heading', { level: 1, name: 'Ada Lovelace' });
    const el = container.querySelector('.home-hero__intro');
    expect(el.textContent).toBe(text);
    expect(el.children.length).toBe(0);
  });
});
