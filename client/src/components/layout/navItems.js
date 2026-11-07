// Public_Site navigation items and active-link rules (Requirements 21.1, 21.2, 21.6).
//
// The active link is computed from the pathname instead of NavLink's prefix matching, so:
//   - Home is active only on `/`.
//   - Projects is active on `/projects` and on every `/projects/:slug` Project Details page.
//   - Every other link is active only on its own page.
//   - Any other path (the not-found page, for example `/about/extra` or `/projects/a/b`)
//     marks no link as active.
// matchPath uses the same rules as <Routes> (case-insensitive, optional trailing slash), so
// a path that renders a page always marks that page's link.

import { matchPath } from 'react-router-dom';

export const NAV_ITEMS = Object.freeze([
  { key: 'home', label: 'Home', to: '/', patterns: ['/'] },
  { key: 'about', label: 'About', to: '/about', patterns: ['/about'] },
  { key: 'skills', label: 'Skills', to: '/skills', patterns: ['/skills'] },
  { key: 'projects', label: 'Projects', to: '/projects', patterns: ['/projects', '/projects/:slug'] },
  { key: 'experience', label: 'Experience', to: '/experience', patterns: ['/experience'] },
  { key: 'education', label: 'Education', to: '/education', patterns: ['/education'] },
  { key: 'contact', label: 'Contact', to: '/contact', patterns: ['/contact'] },
]);

/** Page names used in the document title (21.6): the navigation label of each page. */
export const PAGE_NAMES = Object.freeze({
  ...Object.fromEntries(NAV_ITEMS.map((item) => [item.key, item.label])),
  notFound: 'Page not found',
});

/**
 * Returns the key of the navigation item that is active for `pathname`, or null when no
 * item is active (for example on the not-found page).
 * @param {string} pathname
 * @returns {string | null}
 */
export function getActiveNavKey(pathname) {
  for (const item of NAV_ITEMS) {
    if (item.patterns.some((path) => matchPath({ path, end: true }, pathname))) return item.key;
  }
  return null;
}
