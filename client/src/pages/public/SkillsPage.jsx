import { useMemo } from 'react';
import { list as listSkills } from '../../api/skillsApi.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePublicPageTitle } from '../../hooks/usePublicPageTitle.js';
import { groupSkills } from '../../utils/filters.js';
import { PAGE_NAMES } from '../../components/layout/navItems.js';
import {
  EmptyState,
  ErrorState,
  LazyImage,
  LoadingIndicator,
  PLACEHOLDER_ICON,
} from '../../components/common/index.js';
import '../../styles/pages/skills.css';

export const SKILLS_EMPTY_MESSAGE = 'No skills are listed yet.';

const hasText = (value) => typeof value === 'string' && value.trim() !== '';

/** One Skill: decorative icon (or placeholder), name and optional Proficiency_Level (24.2, 24.3, 24.5). */
function SkillItem({ skill }) {
  return (
    <li className="skills-item">
      <LazyImage
        src={skill.icon_url}
        alt=""
        placeholder={PLACEHOLDER_ICON}
        className="skills-item__icon"
        width={32}
        height={32}
      />
      <span className="skills-item__name">{skill.name}</span>
      {hasText(skill.proficiency_level) ? (
        <span className="skills-item__level">{skill.proficiency_level}</span>
      ) : null}
    </li>
  );
}

/**
 * Skills page (Requirement 24). One request for the Skills; grouping is memoised so it runs
 * only when the response changes (32.13). Category headings follow first-appearance order and
 * Skills keep their API order within each category (24.1).
 */
export default function SkillsPage() {
  usePublicPageTitle(PAGE_NAMES.skills);
  const { loading, data, error, retry } = useFetch((signal) => listSkills({ signal }), []);
  const groups = useMemo(() => groupSkills(data ?? []), [data]);

  let content;
  if (loading) {
    content = <LoadingIndicator label="Loading skills…" />;
  } else if (error) {
    content = <ErrorState message={error?.message} onRetry={retry} />;
  } else if (groups.length === 0) {
    content = <EmptyState message={SKILLS_EMPTY_MESSAGE} />;
  } else {
    content = (
      <div className="skills-groups">
        {groups.map((group, index) => (
          <section
            key={`${index}-${group.category}`}
            className="skills-group"
            aria-labelledby={`skills-group-${index}`}
          >
            <h2 id={`skills-group-${index}`} className="skills-group__title">
              {group.category}
            </h2>
            <ul className="skills-list">
              {group.skills.map((skill, skillIndex) => (
                <SkillItem key={skill?.id ?? `i-${skillIndex}`} skill={skill} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="container skills-page">
      <header className="page-header">
        <h1 className="page-header__title">{PAGE_NAMES.skills}</h1>
      </header>
      {content}
    </div>
  );
}
