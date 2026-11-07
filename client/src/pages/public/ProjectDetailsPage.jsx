import { Link, useParams } from 'react-router-dom';
import { getPublic as getProject } from '../../api/projectsApi.js';
import { ApiError } from '../../api/apiClient.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePublicPageTitle } from '../../hooks/usePublicPageTitle.js';
import {
  ErrorState,
  LazyImage,
  LoadingIndicator,
  MultilineText,
  PLACEHOLDER_PROJECT,
  SafeLink,
  hasText,
} from '../../components/common/index.js';
import '../../styles/pages/project-details.css';

export const PROJECT_NOT_FOUND_TITLE = 'Project not found';
export const PROJECT_NOT_FOUND_MESSAGE =
  'The project you are looking for does not exist or is no longer available.';
export const BACK_TO_PROJECTS_LABEL = 'Back to projects';

/** Accessible h1 while the Project is loading or failed to load (34.6). */
const PENDING_HEADING = 'Project details';

/** Text sections in display order (26.1). Each is omitted when its value is blank (26.3). */
const TEXT_SECTIONS = [
  { key: 'full_description', title: 'Overview' },
  { key: 'problem_statement', title: 'Problem statement' },
  { key: 'objectives', title: 'Objectives' },
  { key: 'challenges', title: 'Challenges' },
  { key: 'solutions', title: 'Solutions' },
];

const isNotFound = (error) => error instanceof ApiError && error.status === 404;

const technologyName = (tech) => (typeof tech === 'string' ? tech : tech?.name);

/** One h2 section; ids keep headings unique so `aria-labelledby` is valid. */
function DetailSection({ id, title, children }) {
  const headingId = `project-details-${id}`;
  return (
    <section className="project-details__section" aria-labelledby={headingId}>
      <h2 id={headingId} className="project-details__section-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The loaded Project: header, image, text sections, features, technologies (26.1-26.3, 26.6). */
function ProjectContent({ project }) {
  const title = hasText(project.title) ? project.title : '';
  const features = Array.isArray(project.features) ? project.features.filter(hasText) : [];
  const technologies = Array.isArray(project.technologies)
    ? project.technologies.filter((tech) => hasText(technologyName(tech)))
    : [];
  const hasGithub = hasText(project.github_url);
  const hasDemo = hasText(project.live_demo_url);

  return (
    <article className="project-details">
      <header className="page-header project-details__header">
        <h1 className="page-header__title">{title}</h1>
        {hasGithub || hasDemo ? (
          <div className="cluster project-details__links">
            {hasGithub ? (
              <SafeLink href={project.github_url} className="btn btn--secondary" fallback={null}>
                GitHub
              </SafeLink>
            ) : null}
            {hasDemo ? (
              <SafeLink href={project.live_demo_url} className="btn btn--primary" fallback={null}>
                Live Demo
              </SafeLink>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="project-details__media">
        <LazyImage
          src={project.image_url}
          alt={title}
          placeholder={PLACEHOLDER_PROJECT}
          className="project-details__image"
          width={1200}
          height={675}
          eager
        />
      </div>

      <div className="project-details__sections">
        {TEXT_SECTIONS.filter(({ key }) => hasText(project[key])).map(({ key, title: heading }) => (
          <DetailSection key={key} id={key} title={heading}>
            <MultilineText text={project[key]} className="project-details__text" />
          </DetailSection>
        ))}

        {features.length > 0 ? (
          <DetailSection id="features" title="Features">
            <ul className="bullet-list project-details__features">
              {features.map((feature, index) => (
                <li key={index} className="pre-line">
                  {feature}
                </li>
              ))}
            </ul>
          </DetailSection>
        ) : null}

        {technologies.length > 0 ? (
          <DetailSection id="technologies" title="Technologies">
            <ul className="tag-list">
              {technologies.map((tech, index) => (
                <li key={tech?.id ?? `t-${index}`} className="tag">
                  {technologyName(tech)}
                </li>
              ))}
            </ul>
          </DetailSection>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Project Details page (Requirement 26). Requests the Project by the route Slug; on a Slug
 * change useFetch aborts the previous request and shows only the latest result (32.15).
 * A link back to the Projects page is shown in every state (26.5). The document title is the
 * Project title once loaded (21.6), "Project not found" for a 404, and the site title alone
 * otherwise.
 */
export default function ProjectDetailsPage() {
  const { slug } = useParams();
  const { loading, data, error, retry } = useFetch((signal) => getProject(slug, { signal }), [slug]);

  const notFound = !loading && (isNotFound(error) || (!error && !data));
  const project = !loading && !error && data ? data : null;

  let pageName;
  if (project && hasText(project.title)) pageName = project.title;
  else if (notFound) pageName = PROJECT_NOT_FOUND_TITLE;
  usePublicPageTitle(pageName);

  let content;
  if (loading) {
    content = (
      <>
        <h1 className="visually-hidden">{PENDING_HEADING}</h1>
        <LoadingIndicator label="Loading project…" />
      </>
    );
  } else if (notFound) {
    content = (
      <header className="page-header">
        <h1 className="page-header__title">{PROJECT_NOT_FOUND_TITLE}</h1>
        <p className="page-header__lead">{PROJECT_NOT_FOUND_MESSAGE}</p>
      </header>
    );
  } else if (error) {
    content = (
      <>
        <h1 className="visually-hidden">{PENDING_HEADING}</h1>
        <ErrorState message={error?.message} onRetry={retry} />
      </>
    );
  } else {
    content = <ProjectContent project={project} />;
  }

  return (
    <div className="container project-details-page">
      <div className="project-details-page__back">
        <Link to="/projects" className="project-details-page__back-link">
          <span aria-hidden="true">← </span>
          {BACK_TO_PROJECTS_LABEL}
        </Link>
      </div>
      {content}
    </div>
  );
}
