import { Link } from 'react-router-dom';
import { PAGE_NAMES } from '../../components/layout/navItems.js';
import { usePublicPageTitle } from '../../hooks/usePublicPageTitle.js';

/**
 * Public not-found page (Requirements 21.5, 21.6). Rendered by the `*` route inside the
 * PublicLayout, so the navigation bar (with no active link) and the footer are shown and the
 * requested path stays in the address bar.
 */
export default function NotFoundPage() {
  usePublicPageTitle(PAGE_NAMES.notFound);
  return (
    <div className="container page-header">
      <h1 className="page-header__title">Page not found</h1>
      <p className="page-header__lead">The page you are looking for does not exist or has moved.</p>
      <p className="page-header__lead">
        <Link to="/">Go to the Home page</Link>
      </p>
    </div>
  );
}
