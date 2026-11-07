import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/apiClient.js';
import * as educationApi from '../../api/educationApi.js';
import { ConfirmDialog, DataTable } from '../../components/admin/index.js';
import { hasText } from '../../components/common/index.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { formatYearRange } from '../../utils/formatDate.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import '../../styles/pages/admin-education.css';

export const EDUCATION_LIST_HEADING = 'Education';
export const EDUCATION_TABLE_CAPTION = 'Education records';
export const EDUCATION_EMPTY_MESSAGE = 'No education records yet. Add your first one.';
export const EDUCATION_DELETE_FAILED_MESSAGE = 'The education record could not be deleted. Please try again.';
export const EDUCATION_LIST_PATH = '/admin/education';

export const educationEditPath = (id) => `${EDUCATION_LIST_PATH}/${encodeURIComponent(String(id))}/edit`;

/** The name shown in the table row, used by the row actions and the Confirmation_Dialog (31.5). */
export const educationName = (record) =>
  hasText(record?.qualification) ? record.qualification : 'Untitled education record';

/** Error_Response message, or `fallback` for anything that is not an ApiError with a message. */
export const errorMessageOr = (error, fallback) =>
  error instanceof ApiError && hasText(error.message) ? error.message : fallback;

const isUnauthorized = (error) => error instanceof ApiError && error.status === 401;

/**
 * Education management table at `/admin/education` (Requirements 17, 31.3, 31.5, 31.6, 31.11,
 * 31.13, 31.14, 31.16).
 *
 * - One row per Education_Record in API order, with Edit (link to the pre-filled edit form)
 *   and Delete actions. DataTable shows loading, empty and error-with-Retry states.
 * - Delete opens a ConfirmDialog naming the record by its qualification; only Confirm sends
 *   `DELETE /api/education/:id`. While it runs both dialog buttons are disabled.
 * - Success: success Notification and the list is reloaded from the API_Server (31.11).
 *   Failure other than 401: error Notification with the Error_Response message (or the
 *   API_Client's "server could not be reached" message) and the shown list is kept (31.16).
 *   A 401 is left to the Auth_Context session-expiry handling.
 */
export default function EducationListPage() {
  usePageTitle(EDUCATION_LIST_HEADING, ADMIN_TITLE_SUFFIX);
  const { notify } = useNotify();
  const { loading, data, error, retry } = useFetch((signal) => educationApi.list({ signal }), []);
  const { run: runDelete, pending: deleting } = useAsyncAction((id) => educationApi.remove(id));
  const [deleteTarget, setDeleteTarget] = useState(null);
  const tableRef = useRef(null);

  const rows = Array.isArray(data) ? data : [];

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const outcome = await runDelete(target.id);
    if (outcome.status === 'ignored') return;

    setDeleteTarget(null);
    if (outcome.status === 'success') {
      notify({ type: 'success', message: `Deleted education record "${educationName(target)}".` });
      retry();
      return;
    }
    if (isUnauthorized(outcome.error)) return;
    notify({ type: 'error', message: errorMessageOr(outcome.error, EDUCATION_DELETE_FAILED_MESSAGE) });
  };

  const columns = [
    { key: 'qualification', header: 'Qualification', rowHeader: true, render: (row) => educationName(row) },
    { key: 'institution', header: 'Institution' },
    {
      key: 'field_of_study',
      header: 'Field of study',
      render: (row) => (hasText(row.field_of_study) ? row.field_of_study : '—'),
    },
    {
      key: 'years',
      header: 'Years',
      className: 'admin-education-table__years',
      render: (row) => formatYearRange(row.start_year, row.end_year),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'data-table__actions',
      render: (row) => (
        <>
          <Link
            to={educationEditPath(row.id)}
            className="btn btn--secondary btn--sm"
            aria-label={`Edit ${educationName(row)}`}
          >
            Edit
          </Link>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            aria-label={`Delete ${educationName(row)}`}
            onClick={() => setDeleteTarget(row)}
          >
            Delete
          </button>
        </>
      ),
    },
  ];

  return (
    <>
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">{EDUCATION_LIST_HEADING}</h1>
        <div className="admin-page-header__actions">
          <Link to={`${EDUCATION_LIST_PATH}/new`} className="btn btn--primary">
            Add education
          </Link>
        </div>
      </div>

      <DataTable
        ref={tableRef}
        caption={EDUCATION_TABLE_CAPTION}
        className="admin-education-table"
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={retry}
        emptyMessage={EDUCATION_EMPTY_MESSAGE}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete education record?"
        message={
          deleteTarget
            ? `"${educationName(deleteTarget)}"${
                hasText(deleteTarget.institution) ? ` at ${deleteTarget.institution}` : ''
              } will be permanently deleted.`
            : undefined
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        pending={deleting}
        returnFocusTo={tableRef}
      />
    </>
  );
}
