import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { ADMIN_NAV_ITEMS } from './adminNavItems.js';

export const SIDEBAR_ID = 'admin-sidebar';
export const SIDEBAR_BRAND = 'Portfolio admin';

/**
 * Admin_Dashboard sidebar (Requirements 31.1, 31.2, 34.6).
 *
 * - `nav aria-label="Admin"` with the links from adminNavItems.js. NavLink sets
 *   `aria-current="page"` on the current page's link; Overview matches `/admin` only (`end`),
 *   the others also match their sub-paths (`/admin/projects/new` marks Projects).
 * - Below 1024px admin.css keeps the sidebar off-canvas and out of the tab order unless
 *   `data-open="true"`; from 1024px it is always shown and `open` has no visible effect.
 * - When it opens, focus moves to the first link: the sidebar comes before the toggle in the
 *   DOM, so without this the next Tab press would skip it.
 * - The brand is plain text, not a heading: each page renders the only `h1` inside `main`.
 *
 * @param {{ open: boolean, onNavigate: () => void, id?: string }} props
 */
export function Sidebar({ open, onNavigate, id = SIDEBAR_ID }) {
  const navRef = useRef(null);

  useEffect(() => {
    if (open) navRef.current?.querySelector('a')?.focus();
  }, [open]);

  return (
    <div id={id} className="admin-sidebar" data-open={open ? 'true' : 'false'}>
      <span className="admin-sidebar__brand">{SIDEBAR_BRAND}</span>
      <nav ref={navRef} aria-label="Admin" className="admin-sidebar__nav">
        <ul className="admin-sidebar__list">
          {ADMIN_NAV_ITEMS.map((item) => (
            <li key={item.key}>
              <NavLink to={item.to} end={item.end} className="admin-sidebar__link" onClick={onNavigate}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export default Sidebar;
