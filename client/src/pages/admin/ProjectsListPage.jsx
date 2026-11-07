import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import * as projectsApi from '../../api/projectsApi.js';
import { ConfirmDialog, DataTable } from '../../components/admin/index.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import '../../styles/pages/admin-projects.css';

export const PROJECTS_EMPTY_MESSAGE = 'No projects yet. Create your first project.';

const isUnauthorized = (error) => error instanceof ApiError && error.status === 401;

/** The Error_Response message, or the "server could not be reached" text (31.16). */
export const failureMessage = (error) =>
  error instanceof ApiError && typeof error.message === 'string' && error.message.trim() !== ''
    ? error.message
    : NETWORK_ERROR_MESSAGE;

const replaceRow = (rows, project) => rows.map((row) => (row.id === project.id ? { ...row, ...project } : row));

/**
 * Projects management table at `/admin/projects` (Requirements 13.1, 31.3–31.6, 31.11, 31.13,
 * 31.14, 31.16).
 *
 * - Rows come from `GET /api/admin/projects` (published and unpublished, in API order). The
 *   DataTable shows loading, the empty state and an error with Retry; a 401 is left to the
 *   Auth_Context, which ends the session and redirects to the login page.
 * - Status column: the text label Published or Unpublished and a button requesting the opposite
 *   state through `PATCH /api/projects/:id/publish`. The label changes only after a
 *   Success_Response; while the request runs that row's button is disabled (31.4, 31.13).
 * - Edit links to `/admin/projects/:id/edit`. Delete opens the ConfirmDialog naming the title;
 *   the request is sent only on Confirm (31.5). Focus returns to the Delete button, or to the
 *   table region when the row is gone (31.6).
 * - After a successful publish or delete: a success Notification naming the action, the change
 *   applied to the shown row, and the list reloaded from the API_Server in the background
 *   without replacing the table by a loading indicator, so keyboard focus stays where it was
 *   (31.11). A failed reload keeps the updated rows.
 * - A failed publish or delete (not 401) shows an error Notification and leaves the list and
 *   the status unchanged (31.16).
 */
export default function ProjectsListPage() {
  usePageTitle('Projects', ADMIN_TITLE_SUFFIX);
  const { notify } = useNotify();
  const tableRef = useRef(null);

  const { loading, data, error, retry } = useFetch((signal) => projectsApi.listAdmin({ signal }), []);

  // Rows replaced after a mutation. Tied to the `data` object they were derived from, so a new
  // fetch result (initial load, Retry) always wins over an older override.
  const [override, setOverride] = useState(null);
  const rows = override && override.source === data ? override.rows : data;
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  });

  const mountedRef = useRef(false);
  const reloadSeqRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Replaces the shown rows; `next` is an array or a function of the current rows. */
  const showRows = useCallback((next) => {
    setOverride((prev) => {
      const source = dataRef.current;
      const current = (prev && prev.source === source ? prev.rows : source) ?? [];
      return { source, rows: typeof next === 'function' ? next(current) : next };
    });
  }, []);

  const reload = useCallback(async () => {
    const seq = ++reloadSeqRef.current;
    try {
      const fresh = await projectsApi.listAdmin();
      if (mountedRef.current && seq === reloadSeqRef.current && Array.isArray(fresh)) showRows(fresh);
    } catch {
      // Keep the rows already updated from the Success_Response; Retry is not needed for them.
    }
  }, [showRows]);

  // --- Publish toggle ---------------------------------------------------------------------
  const [publishing, setPublishing] = useState(() => new Set());
  const publishingRef = useRef(new Set());

  const togglePublished = async (project) => {
    if (publishingRef.current.has(project.id)) return;
    publishingRef.current.add(project.id);
    setPublishing(new Set(publishingRef.current));
    const next = !project.is_published;
    try {
      const updated = await projectsApi.setPublished(project.id, next);
      if (!mountedRef.current) return;
      const changed = { ...(updated ?? {}), id: project.id, is_published: updated?.is_published ?? next };
      showRows((current) => replaceRow(current, changed));
      notify({ type: 'success', message: `Project "${project.title}" ${next ? 'published' : 'unpublished'}.` });
      reload();
    } catch (err) {
      if (mountedRef.current && !isUnauthorized(err)) notify({ type: 'error', message: failureMessage(err) });
    } finally {
      publishingRef.current.delete(project.id);
      if (mountedRef.current) setPublishing(new Set(publishingRef.current));
    }
  };

  // --- Delete -----------------------------------------------------------------------------
  const [toDelete, setToDelete] = useState(null);
  const { run: runDelete, pending: deleting } = useAsyncAction((id) => projectsApi.remove(id));

  const confirmDelete = async () => {
    const project = toDelete;
    if (!project) return;
    const outcome = await runDelete(project.id);
    if (outcome.status === 'ignored' || !mountedRef.current) return;
    setToDelete(null);
    if (outcome.status === 'success') {
      showRows((current) => current.filter((row) => row.id !== project.id));
      notify({ type: 'success', message: `Project "${project.title}" deleted.` });
      reload();
    } else if (!isUnauthorized(outcome.error)) {
      notify({ type: 'error', message: failureMessage(outcome.error) });
    }
  };

  const columns = [
    { key: 'title', header: 'Title', rowHeader: true },
    { key: 'category', header: 'Category' },
    {
      key: 'status',
      header: 'Status',
      render: (project) => {
        const busy = publishing.has(project.id);
        const action = project.is_published ? 'Unpublish' : 'Publish';
        return (
          <div className="admin-projects__status">
            <span className={project.is_published ? 'badge badge--success' : 'badge badge--muted'}>
              {project.is_published ? 'Published' : 'Unpublished'}
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => togglePublished(project)}
              disabled={busy}
              aria-busy={busy ? 'true' : undefined}
              aria-label={`${action} ${project.title}`}
            >
              {action}
            </button>
          </div>
        );
      },
    },
    { key: 'display_order', header: 'Order', className: 'data-table__numeric' },
    {
      key: 'actions',
      header: 'Actions',
      className: 'data-table__actions',
      render: (project) => (
        <>
          <Link
            to={`/admin/projects/${encodeURIComponent(project.id)}/edit`}
            className="btn btn--secondary btn--sm"
            aria-label={`Edit ${project.title}`}
          >
            Edit
          </Link>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => setToDelete({ id: project.id, title: project.title })}
            aria-label={`Delete ${project.title}`}
          >
            Delete
          </button>
        </>
      ),
    },
  ];

  // A 401 ends the session (Auth_Context redirects); keep showing loading until then.
  const unauthorized = isUnauthorized(error);

  return (
    <div className="admin-projects">
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">Projects</h1>
        <div className="admin-page-header__actions">
          <Link to="/admin/projects/new" className="btn btn--primary">
            New project
          </Link>
        </div>
      </div>

      <DataTable
        ref={tableRef}
        caption="Projects"
        columns={columns}
        rows={rows}
        loading={loading || unauthorized}
        error={unauthorized ? null : error}
        onRetry={retry}
        emptyMessage={PROJECTS_EMPTY_MESSAGE}
      />

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete project?"
        message={toDelete ? `Delete "${toDelete.title}"? This cannot be undone.` : undefined}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
        pending={deleting}
        returnFocusTo={tableRef}
      />
    </div>
  );
}
