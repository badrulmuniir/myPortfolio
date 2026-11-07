import { useSiteData } from '../context/SiteDataContext.jsx';
import { usePageTitle } from './usePageTitle.js';

/**
 * Sets the document title of a Public_Site page to "<page name> | <site_title>", or the page
 * name alone while Settings are loading or failed (Requirements 21.6, 21.9).
 * Must be used inside a SiteDataProvider.
 *
 * @param {string | null | undefined} pageName
 */
export function usePublicPageTitle(pageName) {
  const { settings } = useSiteData();
  usePageTitle(pageName, settings?.site_title);
}

export default usePublicPageTitle;
