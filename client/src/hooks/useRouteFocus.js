import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Moves keyboard focus to the given element (the page's `<main tabIndex="-1">`) whenever the
 * route pathname changes, so keyboard and screen reader users start at the new content
 * (Requirement 34.9). The first render does not move focus, which keeps the Skip link as the
 * first Tab stop on a fresh page load (34.7). Query-string and hash changes do not move focus.
 *
 * Must be used inside a React Router context.
 *
 * @param {{ current: HTMLElement | null }} ref
 */
export function useRouteFocus(ref) {
  const { pathname } = useLocation();
  // Compare with the last pathname instead of a "first run" flag, so the double effect run
  // of React StrictMode does not move focus on mount.
  const previousPathRef = useRef(pathname);

  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    const element = ref.current;
    if (element && typeof element.focus === 'function') {
      element.focus();
    }
  }, [pathname, ref]);
}

export default useRouteFocus;
