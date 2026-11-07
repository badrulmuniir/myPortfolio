import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import * as contactApi from '../../api/contactApi.js';
import { EmptyState, ErrorState, LoadingIndicator, MultilineText } from '../../components/common/index.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import {
  MESSAGES_PATH,
  READ_STATUS_NOT_UPDATED,
  failureMessage,
  formatReceived,
  isUnauthorized,
  senderName,
} from './messagePages.js';
import '../../styles/pages/admin-messages.css';

export const MESSAGE_NOT_FOUND_MESSAGE = 'This message does not exist or has been deleted.';

/** True for a missing message or an id the API_Server rejects. */
const isNotFound = (error) => error?.status === 404 || error?.status === 400;

/** `/admin/messages` with the page and filter the list was showing when View was selected. */
function backPath(state) {
  const from = typeof state?.from === 'string' ? state.from.replace(/^\?/, '') : '';
  return from !== '' ? `${MESSAGES_PATH}?${from}` : MESSAGES_PATH;
}

/**
 * Contact message details at `/admin/messages/:id` (Requirements 19.5, 19.6, 19.7, 19.12, 31.11,
 * 31.16).
 *
 * - Loads `GET /api/contact/:id` (which leaves the read status unchanged) and shows the sender
 *   name, email, subject, received date and the full message text with its line breaks (19.5).
 * - When the loaded message is unread, sends `PATCH /api/contact/:id/read` with `is_read: true`
 *   once. On success the status shows Read; the message list loads fresh data when the
 *   Administrator returns to it, so it shows the message as read without a page reload (19.6).
 *   On failure (not 401) the details stay visible, the status stays Unread (so the list keeps
 *   its Unread label) and an error Notification says the read status was not updated (19.12).
 * - A Mark as read / Mark as unread control sends the opposite state; the status changes only
 *   after a Success_Response, followed by a success Notification (19.7, 31.11). A failure shows
 *   an error Notification and keeps the status (31.16). The control is disabled while any read
 *   status request runs.
 * - 404 (or an invalid id) shows "Message not found" with a link back; other failures show an
 *   error with Retry. A 401 is left to the Auth_Context.
 */
export default function MessageDetailPage() {
  usePageTitle('Message', ADMIN_TITLE_SUFFIX);
  const { id } = useParams();
  const location = useLocation();
  const back = backPath(location.state);

  const { loading, data, error, retry } = useFetch((signal) => contactApi.get(id, { signal }), [id]);

  let content;
  if (loading || isUnauthorized(error)) {
    content = <LoadingIndicator label="Loading message…" />;
  } else if (error && isNotFound(error)) {
    content = (
      <EmptyState title="Message not found" message={MESSAGE_NOT_FOUND_MESSAGE} />
    );
  } else if (error || !data) {
    content = <ErrorState message={error?.message} onRetry={retry} />;
  } else {
    content = <MessageDetails key={data.id} message={data} />;
  }

  return (
    <div className="admin-message">
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">Message</h1>
        <div className="admin-page-header__actions">
          <Link to={back} className="btn btn--secondary">
            Back to messages
          </Link>
        </div>
      </div>
      {content}
    </div>
  );
}

function MessageDetails({ message }) {
  const { notify } = useNotify();
  const [isRead, setIsRead] = useState(message.is_read === true);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(false);
  const autoMarkedRef = useRef(false);
  const name = senderName(message);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Sends one read-status request; resolves true on success. */
  const sendReadState = async (value, { onError }) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    try {
      const updated = await contactApi.setRead(message.id, value);
      if (mountedRef.current) setIsRead(typeof updated?.is_read === 'boolean' ? updated.is_read : value);
      return true;
    } catch (err) {
      if (mountedRef.current && !isUnauthorized(err)) onError(err);
      return false;
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  };

  // Opening an unread message marks it read once (19.6, 19.12). The ref keeps a remounted
  // effect (React StrictMode) from sending a second request.
  useEffect(() => {
    if (message.is_read === true || autoMarkedRef.current) return;
    autoMarkedRef.current = true;
    sendReadState(true, {
      onError: (err) => notify({ type: 'error', message: `${READ_STATUS_NOT_UPDATED} ${failureMessage(err)}` }),
    });
    // Runs once per loaded message; MessageDetails is keyed by the message id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleRead = async () => {
    const next = !isRead;
    const ok = await sendReadState(next, {
      onError: (err) => notify({ type: 'error', message: failureMessage(err) }),
    });
    if (ok && mountedRef.current) {
      notify({ type: 'success', message: `Message from "${name}" marked as ${next ? 'read' : 'unread'}.` });
    }
  };

  const received = formatReceived(message.created_at);

  return (
    <article className="admin-panel admin-message__panel" aria-labelledby="admin-message-subject">
      <h2 id="admin-message-subject" className="admin-message__subject">
        {message.subject}
      </h2>
      <dl className="detail-list admin-message__meta">
        <dt>From</dt>
        <dd>{message.name}</dd>
        <dt>Email</dt>
        <dd>
          <a href={`mailto:${message.email}`}>{message.email}</a>
        </dd>
        <dt>Received</dt>
        <dd>
          <time dateTime={message.created_at}>{received}</time>
        </dd>
        <dt>Status</dt>
        <dd>
          <span className="admin-message__status">
            {isRead ? (
              <span className="admin-messages__read-label">Read</span>
            ) : (
              <span className="badge badge--unread">Unread</span>
            )}
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={toggleRead}
              disabled={pending}
              aria-busy={pending ? 'true' : undefined}
              aria-label={`Mark message from ${name} as ${isRead ? 'unread' : 'read'}`}
            >
              {isRead ? 'Mark as unread' : 'Mark as read'}
            </button>
          </span>
        </dd>
      </dl>
      <h3 className="admin-message__body-title">Message</h3>
      <MultilineText text={message.message} className="admin-message__body" />
    </article>
  );
}
