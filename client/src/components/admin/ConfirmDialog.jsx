import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';

/**
 * Confirmation_Dialog for destructive actions such as Delete (Requirements 31.5, 31.6, 31.13, 34.10).
 *
 * Renders nothing while `open` is false. While open it renders, in a portal on `document.body`,
 * a `.dialog-backdrop` with a `role="dialog" aria-modal="true"` box whose accessible name is
 * `title` (`aria-labelledby`) and whose description is `message` (`aria-describedby`).
 *
 * Keyboard and focus:
 * - On open, focus moves to the first focusable control, which is the Cancel button (it comes
 *   first in the DOM), so a stray Enter never confirms a delete.
 * - Tab and Shift+Tab cycle inside the dialog (useFocusTrap).
 * - Escape calls `onCancel` and never `onConfirm`.
 * - When the dialog closes (`open` becomes false or it unmounts), focus returns to the element
 *   that had focus when it opened (normally the row's Delete button). If that element is no
 *   longer in the document, for example because a successful delete removed the row, focus
 *   goes to `returnFocusTo` (an element, a ref or a function returning an element), normally
 *   the DataTable region.
 *
 * While `pending` (the delete request is running) both buttons are disabled and Escape does
 * nothing, so no second request can start and the dialog cannot be dismissed half way (31.13).
 * The caller closes the dialog when the request completes. Focus stays inside the dialog
 * while the buttons are disabled.
 *
 * The caller decides what Confirm does; the dialog sends no request itself, and closing it by
 * Cancel or Escape only calls `onCancel` (31.5).
 *
 * @param {{
 *   open: boolean,
 *   title: import('react').ReactNode,
 *   message?: import('react').ReactNode,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   onConfirm: () => void,
 *   onCancel: () => void,
 *   pending?: boolean,
 *   returnFocusTo?: HTMLElement | { current: HTMLElement | null } | (() => HTMLElement | null) | null,
 * }} props
 */
export function ConfirmDialog({ open, ...props }) {
  if (!open) return null;
  return createPortal(<DialogBox {...props} />, document.body);
}

function DialogBox({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  pending = false,
  returnFocusTo,
}) {
  const dialogRef = useRef(null);
  const confirmRef = useRef(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const messageId = `${baseId}-message`;
  const hasMessage = message !== undefined && message !== null && message !== '';

  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  });

  useFocusTrap(dialogRef, {
    active: true,
    returnFocusTo,
    onEscape: (event) => {
      event.preventDefault();
      if (pendingRef.current) return;
      onCancel?.();
    },
  });

  // A focused button that becomes disabled loses focus to <body>; keep focus in the dialog.
  useEffect(() => {
    if (!pending) return;
    const dialog = dialogRef.current;
    const active = document.activeElement;
    if (dialog && (active === confirmRef.current || !dialog.contains(active))) dialog.focus();
  }, [pending]);

  const confirm = () => {
    if (pending) return;
    onConfirm?.();
  };

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hasMessage ? messageId : undefined}
        aria-busy={pending ? 'true' : undefined}
        tabIndex={-1}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        {hasMessage ? (
          <div id={messageId} className="dialog__body">
            {typeof message === 'string' ? <p>{message}</p> : message}
          </div>
        ) : null}
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={() => onCancel?.()} disabled={pending}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn--danger"
            onClick={confirm}
            disabled={pending}
            aria-busy={pending ? 'true' : undefined}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
