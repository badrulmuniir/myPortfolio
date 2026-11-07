import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/apiClient.js';
import * as experiencesApi from '../../api/experiencesApi.js';
import { ConfirmDialog, DataTable } from '../../components/admin/index.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { formatDateRange } from '../../utils/formatDate.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import '../../styles/pages/admin-experience.css';

export const EXPERIENCE_LIST_HEADING = 'Experience';
export const EXPERIENCE_EMPTY_MESSAGE = 'No experience entries yet.';
export const EXPERIENCE_DELETED_MESSAGE = 'Experience entry deleted.';
export const EXPERIENCE_BASE_PATH = '/admin/experience';

export const experienceEditPath = (id) => `${EXPERIENCE_BASE_PATH}/${encodeURIComponent(String(id))}/edit`;

/** A 401 is handled by the Auth_Context (session expiry → login page), so it shows nothing here. */
export const isUnauthorized = (error) => error instanceof ApiError && error.status === 401;

/**
 * Admin experience list at `/admin/experience` (Requirements 16, 31.3, 31.5, 31.6, 31.11,
 * 31.13, 31.14, 31.16).
 *
 * - One table row per Experience_Record in API order (start date descending) with Edit and
 *   Delete actions named after the job title ("Edit Developer", "Delete Developer").
 * - DataTable shows loading, empty and error-with-Retry states (31.14).
 * - Delete opens a ConfirmDialog naming the job title; the request is sent only on Confirm,
 *   the Confirm button is disabled while it runs (31.13). Success shows a Notification and
 *   reloads the list (31.11); failure shows an error Notification and leaves the list as shown
 *   (31.16).
 */
export default function ExperienceListPage() {
  usePageTitle(EXPERIENCE_LIST_HEADING, ADMIN_TITLE_SUFFIX);
  const { notify } = useNotify();
  const tableRef = useRef(null);
  const { loading, data, error, retry } = useFetch((signal) => experiencesApi.list({ signal }), []);
  const [pendingDelete, setPendingDelete] = useState(null);
  const { run: runDelete, pending: deleting } = useAsyncAction((id) => experiencesApi.remove(id));

  const rows = Array.isArray(data) ? data : [];
  // While a 401 redirects to the login page, keep the loading state instead of an error.
  const unauthorized = isUnauthorized(error);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const outcome = await runDelete(pendingDelete.id);
    if (outcome.status === 'ignored') return;
    setPendingDelete(null);
    if (outcome.status === 'success') {
      notify({ type: 'success', message: EXPERIENCE_DELETED_MESSAGE });
      retry();
    } else if (!isUnauthorized(outcome.error)) {
      notify({ type: 'error', message: outcome.error?.message || 'The experience entry could not be deleted.' });
    }
  };

  const columns = [
    { key: 'job_title', header: 'Job title', rowHeader: true },
    { key: 'company_name', header: 'Company' },
    { key: 'employment_type', header: 'Type' },
    {
      key: 'dates',
      header: 'Dates',
      className: 'admin-experience-table__dates',
      render: (row) => formatDateRange(row.start_date, row.end_date),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'data-table__actions',
      render: (row) => (
        <div className="admin-experience-table__actions">
          <Link
            to={experienceEditPath(row.id)}
            className="btn btn--secondary btn--sm"
            aria-label={`Edit ${row.job_title}`}
          >
            Edit
          </Link>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-label={`Delete ${row.job_title}`}
            onClick={() => setPendingDelete(row)}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">{EXPERIENCE_LIST_HEADING}</h1>
        <div className="admin-page-header__actions">
          <Link to={`${EXPERIENCE_BASE_PATH}/new`} className="btn btn--primary">
            Add experience
          </Link>
        </div>
      </div>

      <DataTable
        ref={tableRef}
        caption="Experience entries"
        columns={columns}
        rows={rows}
        loading={loading || unauthorized}
        error={unauthorized ? null : error}
        onRetry={retry}
        emptyMessage={EXPERIENCE_EMPTY_MESSAGE}
        className="admin-experience-table"
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete experience entry?"
        message={
          pendingDelete
            ? `“${pendingDelete.job_title}” at ${pendingDelete.company_name} will be deleted permanently.`
            : undefined
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        pending={deleting}
        returnFocusTo={tableRef}
      />
    </>
  );
}
