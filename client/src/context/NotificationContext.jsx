// Admin_Dashboard Notifications (Requirements 31.11, 31.12, 31.16, 34.11).
//
// Exported API:
//   <NotificationProvider>  holds the Notifications and renders <NotificationRegion /> after
//                           its children, so the live regions exist before any Notification.
//   useNotify()             → { notify, dismiss }; both functions are stable across renders.
//     notify({ type, message }) → id
//       type: 'success' | 'error' (anything else throws a TypeError)
//       success: removed automatically SUCCESS_DISMISS_MS (5 s) after it appears (31.12)
//       error:   stays until dismissed with its close button (31.12, 31.16)
//     dismiss(id)            removes a Notification and clears its timer; unknown ids are ignored
//   NotificationRegion      the live regions; rendered by the provider, do not render it twice
//   SUCCESS_DISMISS_MS, MAX_NOTIFICATIONS
//
// Accessibility (34.11): two live regions are always in the DOM. Success Notifications go to
// role="status" aria-live="polite", error Notifications to role="alert" aria-live="assertive".
// Showing a Notification never moves keyboard focus.
//
// At most MAX_NOTIFICATIONS are shown. When a new one would exceed the limit, the oldest
// success Notification is dropped first, and the oldest error only when no success remains.
// All timers are cleared on dismiss and on unmount; notify() after unmount does nothing.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export const SUCCESS_DISMISS_MS = 5000;
export const MAX_NOTIFICATIONS = 5;

const TYPES = new Set(['success', 'error']);

const NotifyContext = createContext(null);
NotifyContext.displayName = 'NotifyContext';

const NotificationListContext = createContext(null);
NotificationListContext.displayName = 'NotificationListContext';

/** Removes the oldest entries until `list` has at most `max` items, success entries first. */
function trimToLimit(list, max) {
  const next = [...list];
  while (next.length > max) {
    const index = next.findIndex((n) => n.type === 'success');
    next.splice(index === -1 ? 0 : index, 1);
  }
  return next;
}

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const listRef = useRef([]);
  const timersRef = useRef(new Map());
  const nextIdRef = useRef(1);
  const mountedRef = useRef(false);

  const commit = useCallback((next) => {
    listRef.current = next;
    setNotifications(next);
  }, []);

  const clearTimer = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id) => {
      clearTimer(id);
      if (!mountedRef.current) return;
      if (!listRef.current.some((n) => n.id === id)) return;
      commit(listRef.current.filter((n) => n.id !== id));
    },
    [clearTimer, commit],
  );

  const notify = useCallback(
    ({ type, message } = {}) => {
      if (!TYPES.has(type)) {
        throw new TypeError(`notify: type must be "success" or "error", got ${String(type)}`);
      }
      if (!mountedRef.current) return null;

      const id = nextIdRef.current++;
      const next = trimToLimit(
        [...listRef.current, { id, type, message: String(message ?? '') }],
        MAX_NOTIFICATIONS,
      );
      // Clear the timers of any Notification dropped by the limit.
      const kept = new Set(next.map((n) => n.id));
      for (const n of listRef.current) if (!kept.has(n.id)) clearTimer(n.id);

      if (type === 'success') {
        timersRef.current.set(
          id,
          setTimeout(() => dismiss(id), SUCCESS_DISMISS_MS),
        );
      }
      commit(next);
      return id;
    },
    [clearTimer, commit, dismiss],
  );

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const api = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);
  const listValue = useMemo(() => ({ notifications, dismiss }), [notifications, dismiss]);

  return (
    <NotifyContext.Provider value={api}>
      <NotificationListContext.Provider value={listValue}>
        {children}
        <NotificationRegion />
      </NotificationListContext.Provider>
    </NotifyContext.Provider>
  );
}

/** Returns `{ notify, dismiss }`. Must be used inside a NotificationProvider. */
export function useNotify() {
  const value = useContext(NotifyContext);
  if (value === null) {
    throw new Error('useNotify must be used inside a <NotificationProvider>.');
  }
  return value;
}

function NotificationItem({ notification, onDismiss }) {
  return (
    <li className={`notification notification--${notification.type}`}>
      <p className="notification__message">{notification.message}</p>
      <button
        type="button"
        className="notification__close"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(notification.id)}
      >
        <span aria-hidden="true">×</span>
      </button>
    </li>
  );
}

/** The two live regions. Rendered by NotificationProvider. */
export function NotificationRegion() {
  const value = useContext(NotificationListContext);
  if (value === null) {
    throw new Error('NotificationRegion must be rendered inside a <NotificationProvider>.');
  }
  const { notifications, dismiss } = value;
  const successes = notifications.filter((n) => n.type === 'success');
  const errors = notifications.filter((n) => n.type === 'error');

  return (
    <div className="notification-region">
      <div role="status" aria-live="polite">
        <ul className="notification-region__list">
          {successes.map((n) => (
            <NotificationItem key={n.id} notification={n} onDismiss={dismiss} />
          ))}
        </ul>
      </div>
      <div role="alert" aria-live="assertive">
        <ul className="notification-region__list">
          {errors.map((n) => (
            <NotificationItem key={n.id} notification={n} onDismiss={dismiss} />
          ))}
        </ul>
      </div>
    </div>
  );
}
