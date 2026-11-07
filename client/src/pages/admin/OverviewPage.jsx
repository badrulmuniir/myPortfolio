import { Link } from 'react-router-dom';
import * as dashboardApi from '../../api/dashboardApi.js';
import { ADMIN_NAV_ITEMS } from '../../components/admin/adminNavItems.js';
import { ErrorState, LoadingIndicator } from '../../components/common/index.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import '../../styles/pages/admin-overview.css';

export const OVERVIEW_HEADING = 'Dashboard overview';
export const OVERVIEW_ERROR_TITLE = 'The dashboard counts could not be loaded.';

const navPath = (key) => ADMIN_NAV_ITEMS.find((item) => item.key === key).to;

/**
 * One card per Dashboard_Stats count (20.2), linked to the same destination as the matching
 * sidebar link (20.3).
 */
export const STAT_CARDS = Object.freeze([
  { key: 'projects_total', label: 'Total projects', to: navPath('projects') },
  { key: 'projects_published', label: 'Published projects', to: navPath('projects') },
  { key: 'skills', label: 'Skills', to: navPath('skills') },
  { key: 'experiences', label: 'Experience records', to: navPath('experience') },
  { key: 'education', label: 'Education records', to: navPath('education') },
  { key: 'messages_total', label: 'Total messages', to: navPath('messages') },
  { key: 'messages_unread', label: 'Unread messages', to: navPath('messages') },
]);

/** Shows a count as a whole number; anything that is not a non-negative integer shows 0. */
const formatCount = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? String(n) : '0';
};

/**
 * Admin_Dashboard overview at `/admin` (Requirement 20). Loads `GET /api/dashboard/stats` and
 * shows seven linked summary cards. While loading or after a failure no count values are shown;
 * a failure shows an error with Retry in place of the cards (20.7).
 */
export default function OverviewPage() {
  usePageTitle(OVERVIEW_HEADING, ADMIN_TITLE_SUFFIX);
  const { loading, data, error, retry } = useFetch((signal) => dashboardApi.stats({ signal }), []);

  let content;
  if (loading) {
    content = <LoadingIndicator label="Loading dashboard counts…" />;
  } else if (error || !data) {
    content = <ErrorState title={OVERVIEW_ERROR_TITLE} message={error?.message} onRetry={retry} />;
  } else {
    content = (
      <ul className="stat-grid admin-overview-grid" aria-label="Content summary">
        {STAT_CARDS.map((card) => (
          <li key={card.key} className="admin-overview-grid__item">
            <Link to={card.to} className="stat-card admin-overview-card" data-stat={card.key}>
              <span className="stat-card__label">{card.label}</span>
              <span className="stat-card__value">{formatCount(data[card.key])}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">{OVERVIEW_HEADING}</h1>
      </div>
      {content}
    </>
  );
}
