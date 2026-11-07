import { list as listEducation } from '../../api/educationApi.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePublicPageTitle } from '../../hooks/usePublicPageTitle.js';
import { formatYearRange } from '../../utils/formatDate.js';
import { PAGE_NAMES } from '../../components/layout/navItems.js';
import {
  EmptyState,
  ErrorState,
  LoadingIndicator,
  MultilineText,
  hasText,
} from '../../components/common/index.js';
import '../../styles/pages/education.css';

export const EDUCATION_EMPTY_MESSAGE = 'No education entries are available.';

const fetchEducation = (signal) => listEducation({ signal });

/**
 * One Education_Record: qualification as the h2, then institution, optional field of study,
 * year range and optional description (28.1–28.4). Empty optional fields are omitted with no
 * label or placeholder (28.4). Every value is escaped plain text; the description keeps its
 * line breaks (28.5).
 */
function EducationEntry({ record, headingId }) {
  const years = formatYearRange(record?.start_year, record?.end_year);
  return (
    <li className="education-entry">
      <article aria-labelledby={headingId}>
        <h2 id={headingId} className="education-entry__qualification">
          {record?.qualification}
        </h2>
        <p className="education-entry__institution">{record?.institution}</p>
        {hasText(record?.field_of_study) ? (
          <p className="education-entry__field">{record.field_of_study}</p>
        ) : null}
        {years ? <p className="education-entry__years">{years}</p> : null}
        <MultilineText text={record?.description} className="education-entry__description" />
      </article>
    </li>
  );
}

/**
 * Education page (Requirement 28). Entries keep the API order without re-sorting (28.1).
 * The empty state appears only after a successful request with zero records (28.6); a failed
 * request shows the error message and Retry button instead (28.7).
 */
export default function EducationPage() {
  usePublicPageTitle(PAGE_NAMES.education);
  const { loading, data, error, retry } = useFetch(fetchEducation, []);
  const records = Array.isArray(data) ? data : [];

  let content;
  if (loading) {
    content = <LoadingIndicator label="Loading education…" />;
  } else if (error) {
    content = <ErrorState message={error?.message} onRetry={retry} />;
  } else if (records.length === 0) {
    content = <EmptyState message={EDUCATION_EMPTY_MESSAGE} />;
  } else {
    content = (
      <ul className="education-list">
        {records.map((record, index) => (
          <EducationEntry
            key={record?.id ?? `i-${index}`}
            record={record}
            headingId={`education-entry-${index}`}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="container container--narrow education-page">
      <header className="page-header">
        <h1 className="page-header__title">{PAGE_NAMES.education}</h1>
      </header>
      {content}
    </div>
  );
}
