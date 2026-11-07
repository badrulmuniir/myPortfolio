import { useSiteData } from '../../context/SiteDataContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { usePublicPageTitle } from '../../hooks/usePublicPageTitle.js';
import { PAGE_NAMES } from '../../components/layout/navItems.js';
import { EmptyState, ErrorState, LoadingIndicator, MultilineText, hasText } from '../../components/common/index.js';
import * as educationApi from '../../api/educationApi.js';
import '../../styles/pages/about.css';

/** The four Profile sections, in the order Requirement 23.1 lists them. */
export const PROFILE_SECTIONS = Object.freeze([
  { field: 'personal_introduction', id: 'about-introduction', title: 'Personal Introduction' },
  { field: 'biography', id: 'about-biography', title: 'Biography' },
  { field: 'career_interests', id: 'about-career-interests', title: 'Career Interests' },
  { field: 'professional_goals', id: 'about-professional-goals', title: 'Professional Goals' },
]);

export const EDUCATION_SECTION_TITLE = 'Educational Background';
export const ABOUT_EMPTY_MESSAGE = 'There is no background information to show yet.';

const fetchEducation = (signal) => educationApi.list({ signal });

/** One page section with its own h2 (34.6). */
function AboutSection({ id, title, children }) {
  return (
    <section className="section about-section" aria-labelledby={id}>
      <div className="container container--narrow">
        <h2 id={id} className="section__title about-section__title">
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

/** Loading or error state shown in place of the sections of one data source (32.7, 23.6). */
function SourceState({ children }) {
  return (
    <div className="section about-section">
      <div className="container container--narrow">{children}</div>
    </div>
  );
}

/**
 * About page (Requirement 23). The Profile comes from the shared SiteDataContext and the
 * Education_Records from `GET /api/education`. Each source has its own loading and error
 * state, so one failing request only replaces the sections that depend on it (23.6).
 * Every value is rendered as escaped plain text that keeps its line breaks (23.4).
 */
export default function AboutPage() {
  usePublicPageTitle(PAGE_NAMES.about);
  const { profile, profileState } = useSiteData();
  const education = useFetch(fetchEducation, []);

  const profileReady = !profileState.loading && !profileState.error && profile !== null;
  const educationReady = !education.loading && !education.error;

  const profileSections = profileReady
    ? PROFILE_SECTIONS.filter((section) => hasText(profile[section.field]))
    : [];
  const educationRecords = educationReady && Array.isArray(education.data) ? education.data : [];

  // 23.5: both requests succeeded and every one of the five sections is omitted.
  const isEmpty =
    profileReady && educationReady && profileSections.length === 0 && educationRecords.length === 0;

  let profileContent;
  if (profileState.loading) {
    profileContent = (
      <SourceState>
        <LoadingIndicator label="Loading profile…" />
      </SourceState>
    );
  } else if (!profileReady) {
    profileContent = (
      <SourceState>
        <ErrorState message={profileState.error?.message} onRetry={profileState.retry} />
      </SourceState>
    );
  } else {
    profileContent = profileSections.map((section) => (
      <AboutSection key={section.field} id={section.id} title={section.title}>
        <MultilineText text={profile[section.field]} className="prose about-section__text" />
      </AboutSection>
    ));
  }

  let educationContent = null;
  if (education.loading) {
    educationContent = (
      <SourceState>
        <LoadingIndicator label="Loading education…" />
      </SourceState>
    );
  } else if (education.error) {
    educationContent = (
      <SourceState>
        <ErrorState message={education.error?.message} onRetry={education.retry} />
      </SourceState>
    );
  } else if (educationRecords.length > 0) {
    educationContent = (
      <AboutSection id="about-education" title={EDUCATION_SECTION_TITLE}>
        <ul className="about-education">
          {educationRecords.map((record, index) => (
            <li key={record?.id ?? index} className="about-education__item">
              <MultilineText
                as="h3"
                text={record?.qualification}
                className="about-education__qualification"
              />
              <MultilineText text={record?.institution} className="about-education__institution" />
            </li>
          ))}
        </ul>
      </AboutSection>
    );
  }

  return (
    <div className="about-page">
      <div className="container container--narrow page-header">
        <h1 className="page-header__title">{PAGE_NAMES.about}</h1>
      </div>
      {isEmpty ? (
        <SourceState>
          <EmptyState message={ABOUT_EMPTY_MESSAGE} />
        </SourceState>
      ) : (
        <>
          {profileContent}
          {educationContent}
        </>
      )}
    </div>
  );
}
