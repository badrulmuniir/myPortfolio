import { usePageTitle } from '../../hooks/usePageTitle.js';

export const ADMIN_TITLE_SUFFIX = 'Admin';

/**
 * Temporary body for an Admin_Dashboard page until its own task builds it. Rendered inside the
 * AdminLayout's `main`; gives the page its only `h1` and sets the title "<heading> | Admin".
 *
 * @param {{ heading: string }} props
 */
export function AdminPagePlaceholder({ heading }) {
  usePageTitle(heading, ADMIN_TITLE_SUFFIX);
  return (
    <div className="admin-page-header">
      <h1 className="admin-page-header__title">{heading}</h1>
      <p className="text-muted">This page is coming soon.</p>
    </div>
  );
}

export default AdminPagePlaceholder;
