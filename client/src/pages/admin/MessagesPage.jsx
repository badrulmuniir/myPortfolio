import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as contactApi from '../../api/contactApi.js';
import { ConfirmDialog, DataTable } from '../../components/admin/index.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import {
  MESSAGES_PAGE_SIZE,
  MESSAGE_FILTERS,
  failureMessage,
  formatReceived,
  isUnauthorized,
  messageFilter,
  messagePath,
  pageCount,
  parsePage,
  senderName,
} from './messagePages.js';
import '../../styles/pages/admin-messages.css';

const replaceRow = (rows, message) => rows.map((row) => (row.id === message.id ? { ...row, ...message } : row));

/**
 * Contact message table at `/admin/messages` (Requirements 19.7, 19.9, 31.3, 31.5, 31.6, 31.11,
 * 31.13, 31.14, 31.16).
 *
 * - The current page and read filter live in the `page` and `filter` search parameters, so
 *   returning from a message's details shows the same page. Each change sends
 *   `GET /api/contact?page&limit&is_read`; changing the filter goes back to page 1.
 * - Every unread row has the text label "Unread" and the `data-table__row--unread` styling; read
 *   rows have neither (19.9).
 * - Row actions: View (`/admin/messages/:id`), Mark as read / Mark as unread through
 *   `PATCH /api/contact/:id/read`, and Delete behind a ConfirmDialog naming the sender (31.5).
 *   The read label changes only after a Success_Response (19.7); the row's control is disabled
 *   while its request runs (31.13).
 * - After a successful mark or delete: a success Notification naming the action, the change
 *   applied to the shown row, and the page reloaded in the background, keeping focus in place
 *   (31.11). When a reload finds the page past the last one (for example after deleting the
 *   last message on it), the list moves to the last page that has messages.
 * - A failed mark or delete (not 401) shows an error Notification and leaves the list unchanged
 *   (31.16). A 401 is left to the Auth_Context, which ends the session.
 */
export default function MessagesPage() {
  usePageTitle('Messages', ADMIN_TITLE_SUFFIX);
  const { notify } = useNotify();
  const tableRef = useRef(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const page = parsePage(searchParams.get('page'));
  const filter = messageFilter(searchParams.get('filter'));

  const { loading, data, error, retry } = useFetch(
    (signal) => contactApi.list({ page, limit: MESSAGES_PAGE_SIZE, isRead: filter.isRead, signal }),
    [page, filter.value],
  );

  // Rows and meta replaced after a mutation or a background reload. Tied to the `data` object
  // they were derived from, so a new fetch result (page or filter change, Retry) always wins.
  // `fresh` is true when the rows came straight from the API_Server.
  const [override, setOverride] = useState(null);
  const shown =
    override && override.source === data
      ? override
      : data
        ? { rows: Array.isArray(data.data) ? data.data : [], meta: data.meta, fresh: true }
        : null;
  const rows = shown ? shown.rows : null;

  const dataRef = useRef(data);
  const queryRef = useRef({ page, isRead: filter.isRead });
  useEffect(() => {
    dataRef.current = data;
    queryRef.current = { page, isRead: filter.isRead };
  });

  const mountedRef = useRef(false);
  const reloadSeqRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Replaces the shown rows; `next` is a function of the current rows. */
  const showRows = useCallback((next) => {
    setOverride((prev) => {
      const source = dataRef.current;
      const current = prev && prev.source === source ? prev : { rows: source?.data ?? [], meta: source?.meta };
      return { source, rows: next(current.rows ?? []), meta: current.meta, fresh: false };
    });
  }, []);

  const reload = useCallback(async () => {
    const seq = ++reloadSeqRef.current;
    const source = dataRef.current;
    const query = queryRef.current;
    try {
      const fresh = await contactApi.list({ page: query.page, limit: MESSAGES_PAGE_SIZE, isRead: query.isRead });
      if (!mountedRef.current || seq !== reloadSeqRef.current || dataRef.current !== source) return;
      if (fresh && Array.isArray(fresh.data)) {
        setOverride({ source, rows: fresh.data, meta: fresh.meta, fresh: true });
      }
    } catch {
      // Keep the rows already updated from the Success_Response.
    }
  }, []);

  // --- Paging and filter ------------------------------------------------------------------
  const updateQuery = useCallback(
    (changes, options) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined) next.delete(key);
          else next.set(key, value);
        }
        return next;
      }, options);
    },
    [setSearchParams],
  );

  const goToPage = useCallback(
    (target, options) => updateQuery({ page: target > 1 ? String(target) : undefined }, options),
    [updateQuery],
  );

  const chooseFilter = (value) => {
    if (value === filter.value) return;
    updateQuery({ filter: value === 'all' ? undefined : value, page: undefined });
  };

  // Remember the last known total so the paging controls stay in place while a page loads.
  const [knownTotal, setKnownTotal] = useState(null);
  const shownTotal = shown?.meta?.total;
  useEffect(() => {
    if (Number.isInteger(shownTotal)) setKnownTotal(shownTotal);
  }, [shownTotal]);

  const totalPages = pageCount(knownTotal ?? 0, MESSAGES_PAGE_SIZE);

  // A page past the last one comes back empty: move to the last page that has messages.
  const shownFresh = shown?.fresh === true;
  const shownEmpty = Array.isArray(rows) && rows.length === 0;
  useEffect(() => {
    if (!shownFresh || !shownEmpty || page <= 1) return;
    const last = pageCount(Number.isInteger(shownTotal) ? shownTotal : 0, MESSAGES_PAGE_SIZE);
    goToPage(Math.min(page - 1, last), { replace: true });
  }, [shownFresh, shownEmpty, shownTotal, page, goToPage]);

  // --- Mark as read / unread --------------------------------------------------------------
  const [marking, setMarking] = useState(() => new Set());
  const markingRef = useRef(new Set());

  const toggleRead = async (message) => {
    if (markingRef.current.has(message.id)) return;
    markingRef.current.add(message.id);
    setMarking(new Set(markingRef.current));
    const next = !message.is_read;
    try {
      const updated = await contactApi.setRead(message.id, next);
      if (!mountedRef.current) return;
      const isRead = typeof updated?.is_read === 'boolean' ? updated.is_read : next;
      showRows((current) => replaceRow(current, { ...(updated ?? {}), id: message.id, is_read: isRead }));
      notify({
        type: 'success',
        message: `Message from "${senderName(message)}" marked as ${isRead ? 'read' : 'unread'}.`,
      });
      reload();
    } catch (err) {
      if (mountedRef.current && !isUnauthorized(err)) notify({ type: 'error', message: failureMessage(err) });
    } finally {
      markingRef.current.delete(message.id);
      if (mountedRef.current) setMarking(new Set(markingRef.current));
    }
  };

  // --- Delete -----------------------------------------------------------------------------
  const [toDelete, setToDelete] = useState(null);
  const { run: runDelete, pending: deleting } = useAsyncAction((id) => contactApi.remove(id));

  const confirmDelete = async () => {
    const message = toDelete;
    if (!message) return;
    const outcome = await runDelete(message.id);
    if (outcome.status === 'ignored' || !mountedRef.current) return;
    setToDelete(null);
    if (outcome.status === 'success') {
      showRows((current) => current.filter((row) => row.id !== message.id));
      notify({ type: 'success', message: `Message from "${message.name}" deleted.` });
      reload();
    } else if (!isUnauthorized(outcome.error)) {
      notify({ type: 'error', message: failureMessage(outcome.error) });
    }
  };

  const columns = [
    {
      key: 'status',
      header: 'Status',
      render: (message) =>
        message.is_read ? (
          <span className="admin-messages__read-label">Read</span>
        ) : (
          <span className="badge badge--unread">Unread</span>
        ),
    },
    { key: 'name', header: 'From', rowHeader: true },
    { key: 'email', header: 'Email', className: 'admin-messages__email' },
    { key: 'subject', header: 'Subject', className: 'admin-messages__subject' },
    {
      key: 'created_at',
      header: 'Received',
      className: 'admin-messages__received',
      render: (message) => <time dateTime={message.created_at}>{formatReceived(message.created_at)}</time>,
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'data-table__actions',
      render: (message) => {
        const name = senderName(message);
        const busy = marking.has(message.id);
        return (
          <>
            <Link
              to={messagePath(message.id)}
              state={{ from: searchParams.toString() }}
              className="btn btn--secondary btn--sm"
              aria-label={`View message from ${name}`}
            >
              View
            </Link>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => toggleRead(message)}
              disabled={busy}
              aria-busy={busy ? 'true' : undefined}
              aria-label={`Mark message from ${name} as ${message.is_read ? 'unread' : 'read'}`}
            >
              {message.is_read ? 'Mark as unread' : 'Mark as read'}
            </button>
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => setToDelete({ id: message.id, name })}
              aria-label={`Delete message from ${name}`}
            >
              Delete
            </button>
          </>
        );
      },
    },
  ];

  // A 401 ends the session (Auth_Context redirects); keep showing loading until then.
  const unauthorized = isUnauthorized(error);
  const showPaging = knownTotal !== null && (totalPages > 1 || page > 1);
  const atFirst = page <= 1;
  const atLast = page >= totalPages;

  return (
    <div className="admin-messages">
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">Messages</h1>
      </div>

      <div className="filter-bar admin-messages__filters" role="group" aria-label="Filter messages by read status">
        {MESSAGE_FILTERS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className="filter-button"
            aria-pressed={entry.value === filter.value}
            onClick={() => chooseFilter(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <DataTable
        ref={tableRef}
        caption="Messages"
        columns={columns}
        rows={rows}
        rowClassName={(message) => (message.is_read ? undefined : 'data-table__row--unread admin-messages__row--unread')}
        loading={loading || unauthorized}
        error={unauthorized ? null : error}
        onRetry={retry}
        emptyMessage={filter.empty}
      />

      {showPaging ? (
        <nav className="pagination admin-messages__pagination" aria-label="Message pages">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            aria-disabled={atFirst ? 'true' : undefined}
            onClick={() => {
              if (!atFirst) goToPage(Math.min(page - 1, totalPages));
            }}
          >
            Previous
          </button>
          <p className="pagination__info" aria-live="polite">
            {loading ? `Page ${page}` : `Page ${page} of ${totalPages} (${knownTotal} ${knownTotal === 1 ? 'message' : 'messages'})`}
          </p>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            aria-disabled={atLast ? 'true' : undefined}
            onClick={() => {
              if (!atLast) goToPage(page + 1);
            }}
          >
            Next
          </button>
        </nav>
      ) : null}

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete message?"
        message={toDelete ? `Delete the message from "${toDelete.name}"? This cannot be undone.` : undefined}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
        pending={deleting}
        returnFocusTo={tableRef}
      />
    </div>
  );
}
