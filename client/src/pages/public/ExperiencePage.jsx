import { list as listExperiences } from '../../api/experiencesApi.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePublicPageTitle } from '../../hooks/usePublicPageTitle.js';
import { formatDateRange } from '../../utils/formatDate.js';
import { PAGE_NAMES } from '../../components/layout/navItems.js';
import {
  EmptyState,
  ErrorState,
  LoadingIndicator,
  MultilineText,
  hasText,
} from '../../components/common/index.js';
import '../../styles/pages/experience.css';

export const EXPERIENCE_EMPTY_MESSAGE = 'No work experience is listed yet.';

/** Non-empty responsibility items in stored order (27.2, 27.5). */
const responsibilitiesOf = (experience) =>
  Array.isArray(experience?.responsibilities) ? experience.responsibilities.filter(hasText) : [];

/**
 * One Experience_Record: job title (h2), company, Employment_Type, date range, optional
 * description and optional responsibilities list (27.1–27.7). All values render as React text
 * children, so HTML markup shows as literal characters (27.7).
 */
function ExperienceEntry({ experience, index }) {
  const headingId = `experience-entry-${index}`;
  const dateRange = formatDateRange(experience.start_date, experience.end_date);
  const responsibilities = responsibilitiesOf(experience);

  return (
    <article className="experience-entry" aria-labelledby={headingId}>
      <header className="experience-entry__header">
        <h2 id={headingId} className="experience-entry__title">
          {experience.job_title}
        </h2>
        <p className="experience-entry__company">{experience.company_name}</p>
        <p className="experience-entry__meta">
          {hasText(experience.employment_type) ? (
            <span className="experience-entry__type">{experience.employment_type}</span>
          ) : null}
          {dateRange ? <span className="experience-entry__dates">{dateRange}</span> : null}
        </p>
      </header>
      <MultilineText text={experience.description} className="experience-entry__description" />
      {responsibilities.length > 0 ? (
        <ul className="experience-entry__responsibilities">
          {responsibilities.map((item, itemIndex) => (
            <li key={itemIndex}>{item}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/**
 * Experience page (Requirement 27). One request; entries keep the API order (27.1). The
 * empty-state message shows only after a successful empty response, never on failure (27.8).
 */
export default function ExperiencePage() {
  usePublicPageTitle(PAGE_NAMES.experience);
  const { loading, data, error, retry } = useFetch((signal) => listExperiences({ signal }), []);
  const experiences = Array.isArray(data) ? data : [];

  let content;
  if (loading) {
    content = <LoadingIndicator label="Loading experience…" />;
  } else if (error) {
    content = <ErrorState message={error?.message} onRetry={retry} />;
  } else if (experiences.length === 0) {
    content = <EmptyState message={EXPERIENCE_EMPTY_MESSAGE} />;
  } else {
    content = (
      <div className="experience-list">
        {experiences.map((experience, index) => (
          <ExperienceEntry key={experience?.id ?? `i-${index}`} experience={experience} index={index} />
        ))}
      </div>
    );
  }

  return (
    <div className="container experience-page">
      <header className="page-header">
        <h1 className="page-header__title">{PAGE_NAMES.experience}</h1>
      </header>
      {content}
    </div>
  );
}
