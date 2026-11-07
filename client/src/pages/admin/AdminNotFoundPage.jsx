import { Link } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';

/**
 * Unknown path below /admin, shown inside the protected AdminLayout. Signed-out visitors never
 * see it: ProtectedRoute redirects them to the login page first.
 */
export default function AdminNotFoundPage() {
  usePageTitle('Page not found', ADMIN_TITLE_SUFFIX);
  return (
    <div className="admin-page-header">
      <h1 className="admin-page-header__title">Page not found</h1>
      <p>
        <Link to="/admin">Go to the dashboard overview</Link>
      </p>
    </div>
  );
}
