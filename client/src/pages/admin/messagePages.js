// Helpers shared by the contact message pages (Requirements 19.5–19.9, 19.12, 31.16).

import { NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';

export const MESSAGES_PATH = '/admin/messages';
export const messagePath = (id) => `${MESSAGES_PATH}/${encodeURIComponent(String(id))}`;

/** Messages per list page (the API_Server default, 19.1). */
export const MESSAGES_PAGE_SIZE = 20;

/** Read filter values kept in the `filter` search parameter of the list page. */
export const MESSAGE_FILTERS = Object.freeze([
  { value: 'all', label: 'All', isRead: undefined, empty: 'No messages yet.' },
  { value: 'unread', label: 'Unread', isRead: false, empty: 'No unread messages.' },
  { value: 'read', label: 'Read', isRead: true, empty: 'No read messages.' },
]);

/** The filter entry for a `filter` search parameter; anything unknown means All. */
export function messageFilter(value) {
  return MESSAGE_FILTERS.find((entry) => entry.value === value) ?? MESSAGE_FILTERS[0];
}

/** A `page` search parameter as a positive integer; anything else means page 1. */
export function parsePage(value) {
  if (typeof value !== 'string' || !/^[0-9]{1,9}$/.test(value)) return 1;
  const page = Number(value);
  return page >= 1 ? page : 1;
}

/** Number of pages for `total` messages, at least 1. */
export function pageCount(total, limit = MESSAGES_PAGE_SIZE) {
  const count = Number.isInteger(total) && total > 0 ? Math.ceil(total / limit) : 1;
  return Math.max(1, count);
}

/**
 * A `created_at` timestamp as a local date and time, for example "Mar 5, 2025, 2:30 PM".
 * Returns '' for a value that is not a readable timestamp.
 */
export function formatReceived(value) {
  if (typeof value !== 'string' || value.trim() === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** The sender name used in labels, Notifications and the Confirmation_Dialog. */
export const senderName = (message) =>
  typeof message?.name === 'string' && message.name.trim() !== '' ? message.name : 'unknown sender';

/** True for a 401 failure. The API_Client's unauthorized handler deals with those (6.4). */
export const isUnauthorized = (error) => error?.status === 401;

/** The Error_Response message, or the "server could not be reached" message (31.16). */
export function failureMessage(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  return message !== '' ? message : NETWORK_ERROR_MESSAGE;
}

/** Text of the Notification shown when the mark-read request sent on open fails (19.12). */
export const READ_STATUS_NOT_UPDATED = 'The read status was not updated.';
