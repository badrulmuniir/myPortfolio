import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/**
 * Returns the keyboard-focusable elements inside `container` in DOM (tab) order.
 * Elements with `tabindex="-1"` or inside a `hidden` / `inert` subtree are excluded.
 *
 * @param {HTMLElement | null} container
 * @returns {HTMLElement[]}
 */
export function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[hidden], [inert]'),
  );
}

const resolveElement = (target) => {
  const value = typeof target === 'function' ? target() : target;
  if (value && typeof value === 'object' && 'current' in value) return value.current;
  return value ?? null;
};

const canFocus = (el) => el && el.isConnected && typeof el.focus === 'function';

/**
 * Keeps keyboard focus inside a modal such as the Confirmation_Dialog (Requirements 31.6, 34.10).
 *
 * While `active`:
 * - focus moves to the first focusable element inside `ref.current` (or to the container itself,
 *   which should then have `tabIndex={-1}`, when it has none);
 * - Tab on the last element wraps to the first, Shift+Tab on the first wraps to the last, and
 *   focus that lands outside the container is pulled back inside;
 * - Escape calls `onEscape(event)`.
 *
 * When `active` becomes false or the component unmounts, focus returns to the element that had
 * focus before activation. If that element is no longer in the document (for example the Delete
 * button of a row that was just deleted), focus goes to `returnFocusTo` instead.
 *
 * @param {{ current: HTMLElement | null }} ref The dialog container.
 * @param {{
 *   active?: boolean,
 *   onEscape?: (event: KeyboardEvent) => void,
 *   returnFocusTo?: HTMLElement | { current: HTMLElement | null } | (() => HTMLElement | null) | null,
 * }} [options] `returnFocusTo` is resolved when the trap deactivates.
 */
export function useFocusTrap(ref, { active = true, onEscape, returnFocusTo } = {}) {
  const onEscapeRef = useRef(onEscape);
  const returnFocusToRef = useRef(returnFocusTo);

  useEffect(() => {
    onEscapeRef.current = onEscape;
    returnFocusToRef.current = returnFocusTo;
  });

  useEffect(() => {
    if (!active) return undefined;
    const container = ref.current;
    if (!container) return undefined;

    const previouslyFocused = document.activeElement;

    const focusFirst = () => {
      const [first] = getFocusableElements(container);
      (first ?? container).focus();
    };

    if (!container.contains(document.activeElement)) focusFirst();

    const onKeyDown = (event) => {
      if (event.key === 'Escape' || event.key === 'Esc') {
        onEscapeRef.current?.(event);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      const outside = !container.contains(current);

      if (event.shiftKey && (current === first || current === container || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (event) => {
      if (!container.contains(event.target)) focusFirst();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);

      const target = canFocus(previouslyFocused) && previouslyFocused !== document.body
        ? previouslyFocused
        : resolveElement(returnFocusToRef.current);
      if (canFocus(target)) target.focus();
    };
  }, [active, ref]);
}

export default useFocusTrap;
