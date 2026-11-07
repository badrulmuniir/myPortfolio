import { Link } from 'react-router-dom';
import { PAGE_NAMES } from '../../components/layout/navItems.js';
import { useSiteData } from '../../context/SiteDataContext.jsx';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import {
  ErrorState,
  LazyImage,
  LoadingIndicator,
  MultilineText,
  PLACEHOLDER_PROFILE,
  SafeLink,
  hasText,
} from '../../components/common/index.js';
import { isValidUrl } from '../../utils/url.js';
import '../../styles/pages/home.css';

/**
 * Home page (Requirement 22). Uses the Profile and Settings shared by SiteDataProvider, so it
 * sends no requests of its own.
 *
 * - Loaded: the Profile name is the page's only h1, followed by the professional title, the
 *   full `hero_introduction` (omitted when empty, 22.6), GitHub/LinkedIn links (omitted when
 *   empty, 22.4, 22.5) and the profile image, or the profile placeholder, with alt text
 *   containing the name (22.1, 22.2).
 * - Loading or failed: a visually hidden "Home" h1 keeps one h1 on the page; the loading
 *   indicator or an error with Retry, which repeats only the failed request(s), replaces the
 *   Profile and hero content (22.7).
 * - The "View Projects" and "Contact Me" buttons are always shown and navigate in the same
 *   tab (22.3).
 */
export default function HomePage() {
  const { settings, profile, settingsState, profileState } = useSiteData();
  usePageTitle(PAGE_NAMES.home, settings?.site_title);

  const failed = [profileState, settingsState].filter((state) => state.error);
  const loading = profileState.loading || settingsState.loading;
  const ready = failed.length === 0 && !loading && profile && settings;

  const retryFailed = () => failed.forEach((state) => state.retry());

  let content;
  if (failed.length > 0) {
    content = (
      <>
        <h1 className="visually-hidden">{PAGE_NAMES.home}</h1>
        <ErrorState message={failed[0].error?.message} onRetry={retryFailed} />
      </>
    );
  } else if (!ready) {
    content = (
      <>
        <h1 className="visually-hidden">{PAGE_NAMES.home}</h1>
        <LoadingIndicator />
      </>
    );
  } else {
    content = <HeroContent profile={profile} settings={settings} />;
  }

  return (
    <div className="container">
      <section className="hero home-hero">
        <div className="home-hero__content">
          {content}
          <div className="hero__actions">
            <Link to="/projects" className="btn btn--primary">
              View Projects
            </Link>
            <Link to="/contact" className="btn btn--secondary">
              Contact Me
            </Link>
          </div>
        </div>
        {ready ? (
          <div className="hero__media">
            <LazyImage
              src={profile.profile_image_url}
              alt={profile.name}
              placeholder={PLACEHOLDER_PROFILE}
              width={288}
              height={288}
              eager
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function HeroContent({ profile, settings }) {
  const socialLinks = [
    { label: 'GitHub', href: profile.github_url },
    { label: 'LinkedIn', href: profile.linkedin_url },
    // Empty values (22.5) and values that are not a Valid_URL get no link and no empty <li>.
  ].filter((link) => isValidUrl(link.href));

  return (
    <>
      <h1 className="hero__title">{profile.name}</h1>
      {hasText(profile.professional_title) ? (
        <p className="hero__subtitle">{profile.professional_title}</p>
      ) : null}
      <MultilineText text={settings.hero_introduction} className="home-hero__intro" />
      {socialLinks.length > 0 ? (
        <ul className="home-hero__social">
          {socialLinks.map((link) => (
            <li key={link.label}>
              <SafeLink href={link.href} className="home-hero__social-link">
                {link.label}
              </SafeLink>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
