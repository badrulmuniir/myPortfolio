import { useEffect } from 'react';

const SEPARATOR = ' | ';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Builds the document title: "<page name> | <site title>", or the page name alone while the
 * site title is empty or unavailable (Requirements 21.6, 21.9). With no page name (for example
 * a Project Details page before the Project loads) the site title alone is used.
 *
 * @param {string | null | undefined} pageName
 * @param {string | null | undefined} siteTitle
 * @returns {string} '' when both values are empty.
 */
export function formatPageTitle(pageName, siteTitle) {
  const page = clean(pageName);
  const site = clean(siteTitle);
  if (page && site) return `${page}${SEPARATOR}${site}`;
  return page || site;
}

/**
 * Sets `document.title` from the page name and the Settings `site_title` (21.6, 21.9, 34.9).
 * The title is updated whenever either value changes. When both are empty it is left unchanged.
 *
 * @param {string | null | undefined} pageName
 * @param {string | null | undefined} siteTitle
 */
export function usePageTitle(pageName, siteTitle) {
  useEffect(() => {
    const title = formatPageTitle(pageName, siteTitle);
    if (title) document.title = title;
  }, [pageName, siteTitle]);
}

export default usePageTitle;
