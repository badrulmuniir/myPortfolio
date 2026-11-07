import { useAuth } from '../../context/AuthContext.jsx';

export const TOPBAR_TITLE = 'Admin dashboard';

/**
 * Admin_Dashboard top bar (Requirements 6.3, 31.1, 31.2).
 *
 * - The sidebar toggle ("Menu"), shown only below 1024px by admin.css. It reports the sidebar
 *   state through `aria-expanded` and names the sidebar with `aria-controls`.
 * - The title is plain text, not a heading: each page renders the only `h1` inside `main`.
 * - The authenticated Administrator's email from the Auth_Context and a Logout button.
 *   `logout()` clears the session and navigates to /admin/login without sending a request.
 *
 * @param {{
 *   sidebarOpen: boolean,
 *   onToggleSidebar: () => void,
 *   sidebarId: string,
 *   toggleRef?: { current: HTMLButtonElement | null },
 * }} props
 */
export function Topbar({ sidebarOpen, onToggleSidebar, sidebarId, toggleRef }) {
  const { admin, logout } = useAuth();

  return (
    <header className="admin-topbar">
      <button
        ref={toggleRef}
        type="button"
        className="sidebar-toggle"
        aria-expanded={sidebarOpen}
        aria-controls={sidebarId}
        onClick={onToggleSidebar}
      >
        Menu
      </button>
      <span className="admin-topbar__title">{TOPBAR_TITLE}</span>
      <div className="admin-topbar__actions">
        {admin?.email ? <span className="text-small text-muted">{admin.email}</span> : null}
        <button type="button" className="btn btn--secondary" onClick={logout}>
          Logout
        </button>
      </div>
    </header>
  );
}

export default Topbar;
