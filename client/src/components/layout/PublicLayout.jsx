import { useRef } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useSiteData } from '../../context/SiteDataContext.jsx';
import { hasText } from '../common/MultilineText.jsx';
import { useRouteFocus } from '../../hooks/useRouteFocus.js';
import { SkipLink } from './SkipLink.jsx';
import { Navbar } from './Navbar.jsx';
import { Footer } from './Footer.jsx';

/** Brand text shown while `site_title` is loading, empty or unavailable (21.9). */
export const BRAND_FALLBACK = 'Portfolio';

/**
 * Layout of every Public_Site page, including the not-found page (Requirements 21.1, 21.4,
 * 34.6, 34.7, 34.9): Skip link (first focusable element), one `header` with the brand and the
 * Navbar, one `main#main` that receives focus on route changes, and one `footer`.
 * Must be rendered inside a SiteDataProvider.
 */
export function PublicLayout() {
  const mainRef = useRef(null);
  useRouteFocus(mainRef);
  const { settings } = useSiteData();
  const brand = hasText(settings?.site_title) ? settings.site_title : BRAND_FALLBACK;

  return (
    <div className="site-shell">
      <SkipLink targetId="main" />
      <header className="site-header">
        <div className="container site-header__inner">
          <Link to="/" className="site-header__brand">
            {brand}
          </Link>
          <Navbar />
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="site-main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

export default PublicLayout;
