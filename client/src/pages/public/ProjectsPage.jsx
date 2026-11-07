import { useMemo, useState } from 'react';
import { PAGE_NAMES } from '../../components/layout/navItems.js';
import { EmptyState, ErrorState, LoadingIndicator } from '../../components/common/index.js';
import { ProjectCard } from '../../components/projects/ProjectCard.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { useSiteData } from '../../context/SiteDataContext.jsx';
import { ALL_FILTER_KEY, deriveFilters, filterProjects } from '../../utils/filters.js';
import * as projectsApi from '../../api/projectsApi.js';
import '../../styles/pages/projects.css';

export const EMPTY_PROJECTS_MESSAGE = 'No projects are available yet.';

// No category parameter: filtering happens client-side on the loaded list (25.1, 25.6).
const fetchProjects = (signal) => projectsApi.listPublic({ signal });

/**
 * Public Projects page (Requirements 25.1-25.9, 32.13, 33.3).
 *
 * Sends GET /api/projects once and shows one card per Published_Project in API order. The
 * filter controls and the visible cards are derived with useMemo, so selecting a filter
 * re-renders from the loaded list without another request. Loading, error (with Retry) and
 * empty states replace the content; filters are shown only when at least one project loaded.
 */
export default function ProjectsPage() {
  const { settings } = useSiteData();
  usePageTitle(PAGE_NAMES.projects, settings?.site_title);

  const { loading, data, error, retry } = useFetch(fetchProjects, []);
  const [selectedKey, setSelectedKey] = useState(ALL_FILTER_KEY);

  const projects = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const filters = useMemo(() => deriveFilters(data ?? []), [data]);
  // A selection that no longer exists after a reload falls back to "All".
  const activeKey = filters.some((filter) => filter.key === selectedKey) ? selectedKey : ALL_FILTER_KEY;
  const visibleProjects = useMemo(() => filterProjects(projects, activeKey), [projects, activeKey]);

  let content;
  if (loading) {
    content = <LoadingIndicator label="Loading projects…" />;
  } else if (error) {
    content = <ErrorState message={error?.message} onRetry={retry} />;
  } else if (projects.length === 0) {
    content = <EmptyState message={EMPTY_PROJECTS_MESSAGE} />;
  } else {
    content = (
      <>
        <div className="filter-bar" role="group" aria-label="Filter projects by category">
          {filters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className="filter-button"
              aria-pressed={filter.key === activeKey}
              onClick={() => setSelectedKey(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <ul className="grid--projects projects-grid" role="list" aria-label="Projects">
          {visibleProjects.map((project) => (
            <li key={project.id ?? project.slug}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      <div className="container page-header">
        <h1 className="page-header__title">{PAGE_NAMES.projects}</h1>
        <p className="page-header__lead">Selected work, from side projects to production apps.</p>
      </div>
      <section className="container section" aria-label="Project list">
        <div className="stack stack--lg">{content}</div>
      </section>
    </>
  );
}
