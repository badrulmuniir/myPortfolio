import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { NAV_ITEMS, getActiveNavKey } from './navItems.js';

export const NAV_ID = 'site-nav';

/**
 * Public_Site navigation (Requirements 21.1-21.3, 21.7, 21.8).
 *
 * - Links in the order Home, About, Skills, Projects, Experience, Education, Contact. They are
 *   router links, so no full page reload happens.
 * - Exactly one link has `aria-current="page"` (and `.is-active`) per the rules in
 *   navItems.js; the not-found page marks none.
 * - Below 768px the links sit behind the "Menu" toggle (CSS hides `.site-nav` unless
 *   `data-open="true"`, and hides the toggle from 768px). The menu starts collapsed, closes
 *   when a link is selected or the route changes, and closes on Escape with focus returned to
 *   the toggle.
 *
 * Renders the toggle and the `nav` as siblings so they take part in the header's flex layout.
 */
export function Navbar() {
  const { pathname } = useLocation();
  const activeKey = getActiveNavKey(pathname);
  const toggleRef = useRef(null);

  // The menu is open only for the path it was opened on, so any navigation closes it.
  const [openPath, setOpenPath] = useState(null);
  const open = openPath === pathname;
  const close = () => setOpenPath(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setOpenPath(null);
      toggleRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls={NAV_ID}
        onClick={() => setOpenPath(open ? null : pathname)}
      >
        Menu
      </button>
      <nav id={NAV_ID} className="site-nav" aria-label="Main" data-open={open ? 'true' : 'false'}>
        <ul className="site-nav__list">
          {NAV_ITEMS.map((item) => {
            const active = item.key === activeKey;
            return (
              <li key={item.key}>
                <Link
                  to={item.to}
                  className={active ? 'site-nav__link is-active' : 'site-nav__link'}
                  aria-current={active ? 'page' : undefined}
                  onClick={close}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

export default Navbar;
