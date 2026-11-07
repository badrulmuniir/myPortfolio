import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import * as contactApi from '../../api/contactApi.js';
import { NotificationProvider } from '../../context/NotificationContext.jsx';
import MessagesPage from './MessagesPage.jsx';
import MessageDetailPage from './MessageDetailPage.jsx';
import { READ_STATUS_NOT_UPDATED, formatReceived, pageCount, parsePage } from './messagePages.js';

vi.mock('../../api/contactApi.js', () => ({
  submit: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  setRead: vi.fn(),
  remove: vi.fn(),
}));

const api = vi.mocked(contactApi);

const message = (overrides = {}) => ({
  id: 1,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  subject: 'Job offer',
  message: 'Hello there,\nwould you like to work with us?',
  is_read: false,
  created_at: '2025-03-05T14:30:00.000Z',
  ...overrides,
});

const page = (rows, meta = {}) => ({ data: rows, meta: { total: rows.length, page: 1, limit: 20, ...meta } });

function Path() {
  const location = useLocation();
  return <p data-testid="path">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NotificationProvider>
        <Path />
        <Routes>
          <Route path="/admin/messages" element={<MessagesPage />} />
          <Route path="/admin/messages/:id" element={<MessageDetailPage />} />
        </Routes>
      </NotificationProvider>
    </MemoryRouter>,
  );
}

const path = () => screen.getByTestId('path').textContent;
const statusRegion = () =>
  screen.getAllByRole('status').find((el) => el.getAttribute('aria-live') === 'polite' && el.closest('.notification-region'));
const alertRegion = () =>
  screen.getAllByRole('alert').find((el) => el.getAttribute('aria-live') === 'assertive' && el.closest('.notification-region'));
const bodyRows = (table) => within(table).getAllByRole('row').slice(1);

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.list.mockResolvedValue(page([]));
});

describe('message page helpers', () => {
  it('parses page parameters and counts pages', () => {
    expect(parsePage('3')).toBe(3);
    for (const bad of [null, '', '0', '-1', '1.5', 'abc']) expect(parsePage(bad)).toBe(1);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(20)).toBe(1);
    expect(pageCount(21)).toBe(2);
    expect(formatReceived('not a date')).toBe('');
    expect(formatReceived('2025-03-05T14:30:00.000Z')).not.toBe('');
  });
});

describe('MessagesPage', () => {
  it('labels and styles unread rows only, with View, mark and Delete actions (19.9, 31.3)', async () => {
    api.list.mockResolvedValue(page([message(), message({ id: 2, name: 'Grace Hopper', is_read: true })]));
    renderAt('/admin/messages');

    const table = await screen.findByRole('table');
    const [unread, read] = bodyRows(table);
    expect(within(unread).queryByText('Unread')).toBeTruthy();
    expect(unread.className).toContain('data-table__row--unread');
    expect(within(read).queryByText('Unread')).toBeNull();
    expect(read.className).not.toContain('data-table__row--unread');

    expect(screen.getByRole('link', { name: 'View message from Grace Hopper' }).getAttribute('href')).toBe(
      '/admin/messages/2',
    );
    expect(screen.getByRole('button', { name: 'Mark message from Ada Lovelace as read' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark message from Grace Hopper as unread' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete message from Ada Lovelace' })).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20, isRead: undefined }));
  });

  it('pages through messages and filters by read status (19.1, 19.2)', async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue(page([message()], { total: 45 }));
    renderAt('/admin/messages');

    expect(await screen.findByText('Page 1 of 3 (45 messages)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous' }).getAttribute('aria-disabled')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(path()).toBe('/admin/messages?page=2');
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    expect(await screen.findByText('Page 2 of 3 (45 messages)')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Unread' }));
    expect(path()).toBe('/admin/messages?filter=unread');
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, isRead: false })),
    );
    expect(screen.getByRole('button', { name: 'Unread' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('moves to the last page when the requested page is past the end', async () => {
    api.list.mockImplementation(async ({ page: requested }) =>
      requested === 1 ? page([message()], { total: 1 }) : page([], { total: 1, page: requested }),
    );
    renderAt('/admin/messages?page=4');

    await waitFor(() => expect(path()).toBe('/admin/messages'));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('changes the read label only after the request succeeds, then notifies and reloads (19.7, 31.11)', async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue(page([message()]));
    let resolve;
    api.setRead.mockReturnValue(new Promise((res) => (resolve = res)));
    renderAt('/admin/messages');

    const toggle = await screen.findByRole('button', { name: 'Mark message from Ada Lovelace as read' });
    await user.click(toggle);
    expect(api.setRead).toHaveBeenCalledWith(1, true);
    expect(toggle.disabled).toBe(true);
    expect(within(screen.getByRole('table')).getByText('Unread')).toBeTruthy();

    api.list.mockResolvedValue(page([message({ is_read: true })]));
    resolve(message({ is_read: true }));

    expect(await screen.findByRole('button', { name: 'Mark message from Ada Lovelace as unread' })).toBeTruthy();
    expect(within(screen.getByRole('table')).queryByText('Unread')).toBeNull();
    expect(within(statusRegion()).getByText('Message from "Ada Lovelace" marked as read.')).toBeTruthy();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('keeps the read label and shows an error Notification when marking fails (31.16)', async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue(page([message()]));
    api.setRead.mockRejectedValue(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }));
    renderAt('/admin/messages');

    await user.click(await screen.findByRole('button', { name: 'Mark message from Ada Lovelace as read' }));

    expect(await within(alertRegion()).findByText(NETWORK_ERROR_MESSAGE)).toBeTruthy();
    expect(within(screen.getByRole('table')).getByText('Unread')).toBeTruthy();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('deletes only after Confirm in a dialog naming the sender (31.5, 31.11)', async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue(page([message(), message({ id: 2, name: 'Grace Hopper' })]));
    api.remove.mockResolvedValue({ id: 2 });
    renderAt('/admin/messages');

    await user.click(await screen.findByRole('button', { name: 'Delete message from Grace Hopper' }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/"Grace Hopper"/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete message from Grace Hopper' }));
    dialog = screen.getByRole('dialog');
    api.list.mockResolvedValue(page([message()]));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(api.remove).toHaveBeenCalledWith(2);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete message from Grace Hopper' })).toBeNull());
    expect(within(statusRegion()).getByText('Message from "Grace Hopper" deleted.')).toBeTruthy();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('shows the empty state, and an error with Retry when loading fails (31.14)', async () => {
    const user = userEvent.setup();
    api.list.mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Load failed' }));
    renderAt('/admin/messages');

    expect(await screen.findByText('Load failed')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No messages yet.')).toBeTruthy();
  });
});

describe('MessageDetailPage', () => {
  it('shows the message, marks it read on open and shows it read in the list afterwards (19.5, 19.6)', async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue(page([message()], { total: 45 }));
    api.get.mockResolvedValue(message());
    api.setRead.mockResolvedValue(message({ is_read: true }));
    renderAt('/admin/messages?page=2');

    await user.click(await screen.findByRole('link', { name: 'View message from Ada Lovelace' }));
    expect(path()).toBe('/admin/messages/1');

    expect(await screen.findByRole('heading', { name: 'Job offer' })).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ada@example.com' }).getAttribute('href')).toBe('mailto:ada@example.com');
    expect(screen.getByText(/would you like to work with us\?/).textContent).toBe(message().message);
    expect(document.querySelector('time').getAttribute('dateTime')).toBe(message().created_at);

    await waitFor(() => expect(screen.getByText('Read')).toBeTruthy());
    expect(api.setRead).toHaveBeenCalledTimes(1);
    expect(api.setRead).toHaveBeenCalledWith(1, true);

    api.list.mockResolvedValue(page([message({ is_read: true })], { total: 45 }));
    await user.click(screen.getByRole('link', { name: 'Back to messages' }));
    expect(path()).toBe('/admin/messages?page=2');
    const table = await screen.findByRole('table');
    expect(within(bodyRows(table)[0]).queryByText('Unread')).toBeNull();
  });

  it('keeps the details and the unread label with a Notification when marking read on open fails (19.12)', async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue(page([message()]));
    api.get.mockResolvedValue(message());
    api.setRead.mockRejectedValue(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Server failed' }));
    renderAt('/admin/messages/1');

    expect(await within(alertRegion()).findByText(`${READ_STATUS_NOT_UPDATED} Server failed`)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Job offer' })).toBeTruthy();
    expect(screen.getByText('Unread')).toBeTruthy();

    await user.click(screen.getByRole('link', { name: 'Back to messages' }));
    const table = await screen.findByRole('table');
    expect(within(bodyRows(table)[0]).getByText('Unread')).toBeTruthy();
  });

  it('sends no request for a read message and lets the Administrator mark it unread (19.7)', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(message({ is_read: true }));
    api.setRead.mockResolvedValue(message({ is_read: false }));
    renderAt('/admin/messages/1');

    const toggle = await screen.findByRole('button', { name: 'Mark message from Ada Lovelace as unread' });
    expect(api.setRead).not.toHaveBeenCalled();
    await user.click(toggle);

    expect(api.setRead).toHaveBeenCalledWith(1, false);
    expect(await screen.findByText('Unread')).toBeTruthy();
    expect(within(statusRegion()).getByText('Message from "Ada Lovelace" marked as unread.')).toBeTruthy();
  });

  it('shows "Message not found" for an unknown id', async () => {
    api.get.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Message not found' }));
    renderAt('/admin/messages/99');

    expect(await screen.findByText('Message not found')).toBeTruthy();
    expect(api.setRead).not.toHaveBeenCalled();
  });
});
