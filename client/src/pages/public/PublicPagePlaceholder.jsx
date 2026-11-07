import { usePublicPageTitle } from '../../hooks/usePublicPageTitle.js';

/**
 * Temporary body for a Public_Site page until its own task builds it. Renders the page's only
 * `h1` and sets the document title (21.6, 34.6).
 *
 * @param {{ heading: string, pageName?: string | null }} props
 *   `pageName` defaults to `heading`; pass null to use the site title alone.
 */
export function PublicPagePlaceholder({ heading, pageName = heading }) {
  usePublicPageTitle(pageName);
  return (
    <div className="container page-header">
      <h1 className="page-header__title">{heading}</h1>
      <p className="page-header__lead">This page is coming soon.</p>
    </div>
  );
}

export default PublicPagePlaceholder;
