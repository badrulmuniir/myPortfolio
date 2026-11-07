import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as skillsApi from '../../api/skillsApi.js';
import { ConfirmDialog, DataTable } from '../../components/admin/index.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { canMove, computeSkillMove } from '../../utils/reorder.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import { NEW_SKILL_PATH, editSkillPath, failureMessage, isUnauthorized, toSkillInput } from './skillPages.js';
import '../../styles/pages/admin-skills.css';

export const SKILLS_HEADING = 'Skills';

const OTHER_DIRECTION = { up: 'down', down: 'up' };

/**
 * Sends one `PUT /api/skills/:id` per changed Skill and waits for all of them (15.5).
 * Resolves with the first failure, or null when every request succeeded.
 */
async function saveMove(skills, skillId, direction) {
  const { updates } = computeSkillMove(skills, skillId, direction);
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const results = await Promise.allSettled(
    updates.map(({ id, display_order: displayOrder }) =>
      skillsApi.update(id, toSkillInput(byId.get(id), displayOrder)),
    ),
  );
  const failed = results.find((result) => result.status === 'rejected');
  return failed ? failed.reason : null;
}

/**
 * Admin skills list at `/admin/skills` (Requirements 15.5, 15.9, 31.3, 31.5, 31.11, 31.14, 31.16).
 *
 * Rows follow the `GET /api/skills` order. Move up / Move down trade places with the
 * neighbouring Skill of the same (exact) category; the controls are disabled for the first and
 * last Skill of each category. After the PUT requests complete, the list is reloaded from the
 * server whether they succeeded or not, so the shown order always matches the stored order.
 * After a reload, focus returns to the moved Skill's move control.
 */
export default function SkillsListPage() {
  usePageTitle(SKILLS_HEADING, ADMIN_TITLE_SUFFIX);
  const { notify } = useNotify();
  const { loading, data, error, retry } = useFetch((signal) => skillsApi.list({ signal }), []);
  const skills = Array.isArray(data) ? data : [];

  const tableRef = useRef(null);
  // What to focus once the reload that follows a move or delete has finished.
  const focusAfterLoadRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const move = useAsyncAction(saveMove);
  const removal = useAsyncAction((skill) => skillsApi.remove(skill.id));
  const busy = move.pending || removal.pending;

  const reload = useCallback(
    (focusTarget) => {
      focusAfterLoadRef.current = focusTarget;
      retry();
    },
    [retry],
  );

  useEffect(() => {
    const target = focusAfterLoadRef.current;
    if (loading || !target) return;
    focusAfterLoadRef.current = null;
    const region = tableRef.current;
    if (!region) return;
    const active = document.activeElement;
    if (active && active !== document.body && document.contains(active)) return;

    let element = null;
    if (target.skillId !== undefined) {
      const id = String(target.skillId);
      const button = (direction) =>
        [...region.querySelectorAll(`[data-move="${direction}"]`)].find((node) => node.dataset.skillId === id);
      element = [button(target.direction), button(OTHER_DIRECTION[target.direction])].find(
        (candidate) => candidate && !candidate.disabled,
      );
    }
    (element ?? region).focus();
  }, [loading, data, error]);

  const handleMove = async (skill, direction) => {
    if (busy || !canMove(skills, skill.id, direction)) return;
    const outcome = await move.run(skills, skill.id, direction);
    if (outcome.status === 'ignored') return;
    const failure = outcome.status === 'error' ? outcome.error : outcome.data;
    if (isUnauthorized(failure)) return; // the session-expiry handler takes over (6.4)
    if (failure) {
      notify({ type: 'error', message: `Could not move ${skill.name}: ${failureMessage(failure)}` });
    } else {
      notify({ type: 'success', message: `Moved ${skill.name} ${direction}.` });
    }
    reload({ skillId: skill.id, direction });
  };

  const confirmDelete = async () => {
    const skill = pendingDelete;
    if (!skill) return;
    const outcome = await removal.run(skill);
    if (outcome.status === 'ignored') return;
    setPendingDelete(null);
    if (outcome.status === 'success') {
      notify({ type: 'success', message: `Deleted skill ${skill.name}.` });
      reload({ region: true });
    } else if (!isUnauthorized(outcome.error)) {
      notify({ type: 'error', message: `Could not delete ${skill.name}: ${failureMessage(outcome.error)}` });
    }
  };

  const moveButton = (skill, direction) => {
    const allowed = canMove(skills, skill.id, direction);
    return (
      <button
        type="button"
        className="btn btn--secondary btn--sm admin-skills__move"
        aria-label={`Move ${skill.name} ${direction}`}
        data-move={direction}
        data-skill-id={skill.id}
        disabled={!allowed}
        // While a request runs the control stays focusable but does nothing.
        aria-disabled={allowed && busy ? 'true' : undefined}
        onClick={() => handleMove(skill, direction)}
      >
        <span aria-hidden="true">{direction === 'up' ? '↑' : '↓'}</span>
        <span className="admin-skills__move-text">{direction === 'up' ? 'Up' : 'Down'}</span>
      </button>
    );
  };

  const columns = [
    { key: 'name', header: 'Name', rowHeader: true },
    { key: 'category', header: 'Category' },
    {
      key: 'proficiency_level',
      header: 'Proficiency',
      render: (skill) =>
        skill.proficiency_level ? skill.proficiency_level : <span className="text-muted">Not set</span>,
    },
    { key: 'display_order', header: 'Order', className: 'data-table__numeric' },
    {
      key: 'actions',
      header: 'Actions',
      className: 'data-table__actions',
      render: (skill) => (
        <>
          {moveButton(skill, 'up')}
          {moveButton(skill, 'down')}
          <Link to={editSkillPath(skill.id)} className="btn btn--secondary btn--sm" aria-label={`Edit ${skill.name}`}>
            Edit
          </Link>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            aria-label={`Delete ${skill.name}`}
            onClick={() => setPendingDelete(skill)}
          >
            Delete
          </button>
        </>
      ),
    },
  ];

  // A 401 is handled by the session-expiry flow, which leaves this page (31.14).
  const listError = error && !isUnauthorized(error) ? error : null;

  return (
    <>
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">{SKILLS_HEADING}</h1>
        <div className="admin-page-header__actions">
          <Link to={NEW_SKILL_PATH} className="btn btn--primary">
            New skill
          </Link>
        </div>
      </div>

      <p className="admin-skills__intro text-muted">
        Skills are grouped by category. Use the move controls to change the order inside a category.
      </p>

      <DataTable
        ref={tableRef}
        caption="Skills"
        className="admin-skills__table"
        columns={columns}
        rows={skills}
        loading={loading || isUnauthorized(error)}
        error={listError}
        onRetry={retry}
        emptyMessage="No skills yet. Add your first skill to show it on the Skills page."
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete skill"
        message={pendingDelete ? `Delete the skill “${pendingDelete.name}”? This cannot be undone.` : undefined}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        pending={removal.pending}
        returnFocusTo={tableRef}
      />
    </>
  );
}
