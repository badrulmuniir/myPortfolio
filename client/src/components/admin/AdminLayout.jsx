import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useRouteFocus } from '../../hooks/useRouteFocus.js';
import { SkipLink } from '../layout/SkipLink.jsx';
import { SIDEBAR_ID, Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';

/** Width from which admin.css always shows the sidebar and hides the toggle (31.2, 33.2). */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Layout of every Admin_Dashboard page except /admin/login (Requirements 6.3, 31.1, 31.2,
 * 34.6, 34.7, 34.9): Skip link (first focusable element), the Sidebar with the `Admin` nav,
 * the Topbar with the sidebar toggle, admin email and Logout, and one `main#main` that
 * receives focus on route changes. Each page renders its own `h1` inside `main`.
 *
 * Sidebar state below 1024px: closed on load. It closes when a sidebar link is selected, on
 * any route change, on Escape and on a backdrop click, and when the viewport grows to 1024px.
 * Escape and the backdrop return focus to the toggle; selecting a link moves focus to `main`.
 */
export function AdminLayout() {
  const mainRef = useRef(null);
  const toggleRef = useRef(null);
  useRouteFocus(mainRef);

  // The sidebar is open only for the path it was opened on, so any navigation closes it.
  const { pathname } = useLocation();
  const [openPath, setOpenPath] = useState(null);
  const open = openPath === pathname;

  const closeToToggle = useCallback(() => {
    setOpenPath(null);
    toggleRef.current?.focus();
  }, []);

  // Selecting a link: a new route moves focus to `main` through useRouteFocus; the current
  // page's link does not change the route, so focus moves here instead of staying on a link
  // that is about to be hidden.
  const closeFromLink = useCallback(() => {
    setOpenPath(null);
    mainRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeToToggle();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closeToToggle]);

  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event) => {
      if (event.matches) setOpenPath(null);
    };
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, [open]);

  return (
    <div className="admin-shell">
      <SkipLink targetId="main" />
      <Sidebar id={SIDEBAR_ID} open={open} onNavigate={closeFromLink} />
      {open ? <div className="admin-backdrop" aria-hidden="true" data-testid="admin-backdrop" onClick={closeToToggle} /> : null}
      <div className="admin-main">
        <Topbar
          sidebarOpen={open}
          onToggleSidebar={() => setOpenPath(open ? null : pathname)}
          sidebarId={SIDEBAR_ID}
          toggleRef={toggleRef}
        />
        <main id="main" ref={mainRef} tabIndex={-1} className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AdminLayout;
