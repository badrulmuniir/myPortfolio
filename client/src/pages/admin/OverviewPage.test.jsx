// Overview page tests (Requirements 20.2, 20.3, 20.7).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import * as dashboardApi from '../../api/dashboardApi.js';
import { ADMIN_NAV_ITEMS } from '../../components/admin/adminNavItems.js';
import OverviewPage, { OVERVIEW_ERROR_TITLE, STAT_CARDS } from './OverviewPage.jsx';

vi.mock('../../api/dashboardApi.js', () => ({ stats: vi.fn() }));

const STATS = {
  projects_total: 12,
  projects_published: 0,
  skills: 7,
  experiences: 3,
  education: 2,
  messages_total: 5,
  messages_unread: 1,
};

const EXPECTED = [
  ['Total projects', '12', '/admin/projects'],
  ['Published projects', '0', '/admin/projects'],
  ['Skills', '7', '/admin/skills'],
  ['Experience records', '3', '/admin/experience'],
  ['Education records', '2', '/admin/education'],
  ['Total messages', '5', '/admin/messages'],
  ['Unread messages', '1', '/admin/messages'],
];

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <OverviewPage />
    </MemoryRouter>,
  );

const cards = () => within(screen.getByRole('list', { name: 'Content summary' })).getAllByRole('link');

afterEach(() => {
  vi.mocked(dashboardApi.stats).mockReset();
});

describe('OverviewPage', () => {
  it('requests the stats once and shows seven labelled cards, including zero values (20.2)', async () => {
    vi.mocked(dashboardApi.stats).mockResolvedValue(STATS);
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard overview' })).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Content summary' })).toBeTruthy();
    expect(dashboardApi.stats).toHaveBeenCalledTimes(1);

    const links = cards();
    expect(links).toHaveLength(7);
    links.forEach((link, i) => {
      const [label, value] = EXPECTED[i];
      expect(link.querySelector('.stat-card__label').textContent).toBe(label);
      expect(link.querySelector('.stat-card__value').textContent).toBe(value);
    });
    expect(document.title).toBe('Dashboard overview | Admin');
  });

  it('links each card to the matching sidebar destination (20.3)', async () => {
    vi.mocked(dashboardApi.stats).mockResolvedValue(STATS);
    renderPage();
    await screen.findByRole('list', { name: 'Content summary' });

    const sidebarPaths = new Set(ADMIN_NAV_ITEMS.map((item) => item.to));
    cards().forEach((link, i) => {
      const href = link.getAttribute('href');
      expect(href).toBe(EXPECTED[i][2]);
      expect(sidebarPaths.has(href)).toBe(true);
    });
    expect(STAT_CARDS.map((card) => card.key)).toEqual(Object.keys(STATS));
  });

  it('shows an error with Retry and no count values on failure, and Retry repeats the request (20.7)', async () => {
    vi.mocked(dashboardApi.stats)
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }))
      .mockResolvedValueOnce(STATS);
    const user = userEvent.setup();
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(OVERVIEW_ERROR_TITLE);
    expect(alert.textContent).toContain(NETWORK_ERROR_MESSAGE);
    expect(screen.queryByRole('list', { name: 'Content summary' })).toBeNull();
    expect(document.querySelector('.stat-card__value')).toBeNull();

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Content summary' })).toBeTruthy();
    expect(dashboardApi.stats).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(cards()).toHaveLength(7);
  });

  it('shows the error again, still with no values, when the retried request fails (20.7)', async () => {
    vi.mocked(dashboardApi.stats)
      .mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Server error' }))
      .mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Server error' }));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(dashboardApi.stats).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.stat-card__value')).toBeNull();
  });
});
