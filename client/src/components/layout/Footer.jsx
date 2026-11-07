import { useSiteData } from '../../context/SiteDataContext.jsx';
import { SafeLink } from '../common/SafeLink.jsx';
import { hasText } from '../common/MultilineText.jsx';
import { isValidUrl } from '../../utils/url.js';

/**
 * Builds the footer link list: Profile GitHub and LinkedIn, then the Settings Social_Links in
 * stored order (21.4). Items whose value is empty, or whose data is not loaded, are omitted
 * (21.4, 21.9). A URL that is not a Valid_URL is omitted as well, so no non-link text appears
 * in the link list (9.7).
 */
export function buildFooterLinks(settings, profile) {
  const links = [];
  if (isValidUrl(profile?.github_url)) links.push({ key: 'github', label: 'GitHub', url: profile.github_url });
  if (isValidUrl(profile?.linkedin_url)) links.push({ key: 'linkedin', label: 'LinkedIn', url: profile.linkedin_url });
  const social = Array.isArray(settings?.social_links) ? settings.social_links : [];
  social.forEach((link, index) => {
    if (hasText(link?.label) && isValidUrl(link?.url)) {
      links.push({ key: `social-${index}`, label: link.label, url: link.url });
    }
  });
  return links;
}

/**
 * Public_Site footer (Requirements 21.4, 21.9): `footer_text`, the profile and social links
 * (new tab, `rel="noopener noreferrer"` through SafeLink) and the current year from the
 * device clock.
 */
export function Footer() {
  const { settings, profile } = useSiteData();
  const footerText = settings?.footer_text;
  const links = buildFooterLinks(settings, profile);
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        {hasText(footerText) ? <p className="site-footer__text">{footerText}</p> : null}
        {links.length > 0 ? (
          <ul className="site-footer__links">
            {links.map((link) => (
              <li key={link.key}>
                <SafeLink href={link.url}>{link.label}</SafeLink>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="site-footer__year">© {year}</p>
      </div>
    </footer>
  );
}

export default Footer;
