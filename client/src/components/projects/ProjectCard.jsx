import { Link } from 'react-router-dom';
import { LazyImage, SafeLink, PLACEHOLDER_PROJECT } from '../common/index.js';

const hasValue = (value) => typeof value === 'string' && value.trim() !== '';

/** Path of a Project's details page, built from its Slug (25.2). */
export const projectDetailsPath = (slug) => `/projects/${encodeURIComponent(slug ?? '')}`;

/**
 * Project card on the Projects page (Requirements 25.2, 25.3, 25.4, 25.7).
 *
 * Shows the title (h2, so the page keeps a single h1), the thumbnail with alt text equal to the
 * title (the placeholder keeps the same alt when the image URL is empty or fails to load), the
 * short description, the category, the Technology names when there are any, "GitHub" and
 * "Live Demo" links for non-empty URLs (new tab via SafeLink) and a "View Details" link.
 * All values are rendered as plain text.
 *
 * @param {{ project: { title: string, slug: string, short_description?: string, category?: string,
 *           image_url?: string, github_url?: string, live_demo_url?: string,
 *           technologies?: Array<{ id?: number, name: string }> } }} props
 */
export function ProjectCard({ project }) {
  const { title, slug, short_description: shortDescription, category } = project;
  const technologies = Array.isArray(project.technologies)
    ? project.technologies.filter((tech) => hasValue(tech?.name))
    : [];
  const hasGithub = hasValue(project.github_url);
  const hasDemo = hasValue(project.live_demo_url);

  return (
    <article className="project-card">
      <div className="card__media">
        <LazyImage src={project.image_url} alt={title} placeholder={PLACEHOLDER_PROJECT} />
      </div>
      <div className="card__body">
        <h2 className="card__title">{title}</h2>
        {hasValue(category) ? <p className="card__meta">{category}</p> : null}
        {hasValue(shortDescription) ? <p className="card__text">{shortDescription}</p> : null}
        {technologies.length > 0 ? (
          <ul className="tag-list" aria-label="Technologies">
            {technologies.map((tech, index) => (
              <li key={tech.id ?? `${tech.name}-${index}`} className="tag">
                {tech.name}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="card__footer">
          <Link className="btn btn--primary btn--sm" to={projectDetailsPath(slug)}>
            View Details
          </Link>
          {hasGithub ? (
            <SafeLink href={project.github_url} fallback={null}>
              GitHub
            </SafeLink>
          ) : null}
          {hasDemo ? (
            <SafeLink href={project.live_demo_url} fallback={null}>
              Live Demo
            </SafeLink>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default ProjectCard;
