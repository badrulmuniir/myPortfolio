import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/apiClient.js';
import * as projectsApi from '../../api/projectsApi.js';
import * as technologiesApi from '../../api/technologiesApi.js';
import { ConfirmDialog, ListEditor, TagInput } from '../../components/admin/index.js';
import { ErrorState, FormField, LoadingIndicator } from '../../components/common/index.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import {
  DISPLAY_ORDER_MAX,
  DISPLAY_ORDER_MIN,
  FORM_ERROR_KEY,
  PROJECT_FEATURES_MAX,
  PROJECT_TECHNOLOGIES_MAX,
  errorsFromDetails,
  validateProject,
} from '../../utils/validation.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import { failureMessage } from './ProjectsListPage.jsx';
import '../../styles/pages/admin-projects.css';

export const PROJECTS_LIST_PATH = '/admin/projects';
export const SLUG_WARNING_TITLE = 'Change the public URL?';
export const SAVING_LABEL = 'Saving…';

/** Text inputs and textareas in display order (also the order used to focus the first error). */
const TEXT_FIELDS = [
  { name: 'title', label: 'Title', required: true, hint: 'Up to 150 characters' },
  { name: 'slug', label: 'Slug', hint: null },
  { name: 'short_description', label: 'Short description', required: true, multiline: true, rows: 3, hint: 'Up to 300 characters' },
  { name: 'category', label: 'Category', required: true, hint: 'Up to 50 characters' },
  { name: 'full_description', label: 'Full description', multiline: true },
  { name: 'problem_statement', label: 'Problem statement', multiline: true },
  { name: 'objectives', label: 'Objectives', multiline: true },
  { name: 'challenges', label: 'Challenges', multiline: true },
  { name: 'solutions', label: 'Solutions', multiline: true },
  { name: 'image_url', label: 'Image URL', type: 'url', hint: 'An http or https address' },
  { name: 'github_url', label: 'GitHub URL', type: 'url', hint: 'An http or https address' },
  { name: 'live_demo_url', label: 'Live demo URL', type: 'url', hint: 'An http or https address' },
];

const FIELD_ORDER = [...TEXT_FIELDS.map((f) => f.name), 'display_order', 'is_published', 'features', 'technologies'];

const EMPTY_VALUES = Object.freeze({
  ...Object.fromEntries(TEXT_FIELDS.map((f) => [f.name, ''])),
  display_order: '0',
  is_published: false,
  features: [],
  technologies: [],
});

const controlId = (field) => `project-${field}`;
const text = (value) => (typeof value === 'string' ? value : '');

/** Form values from a saved AdminProject; null text values become ''. */
export function valuesFromProject(project) {
  const values = { ...EMPTY_VALUES };
  for (const { name } of TEXT_FIELDS) values[name] = text(project?.[name]);
  values.display_order = Number.isInteger(project?.display_order) ? String(project.display_order) : '0';
  values.is_published = project?.is_published === true;
  values.features = Array.isArray(project?.features) ? project.features.map(text) : [];
  values.technologies = Array.isArray(project?.technologies)
    ? project.technologies.map((t) => (typeof t === 'string' ? t : text(t?.name))).filter((name) => name !== '')
    : [];
  return values;
}

/**
 * True when submitting `slug` would change the public URL of a Published_Project (31.10): the
 * saved Project is published and the submitted Slug is non-empty and differs from the saved one.
 * An empty Slug keeps the saved Slug on update, so it never warns.
 */
export function needsSlugWarning(saved, submittedSlug) {
  return Boolean(
    saved && saved.is_published === true && typeof submittedSlug === 'string' && submittedSlug !== '' && submittedSlug !== saved.slug,
  );
}

/** The first error key in display order, with list items (`features[2]`) under their list. */
function firstErrorKey(errors) {
  for (const field of FIELD_ORDER) {
    if (Object.hasOwn(errors, field)) return field;
    const item = Object.keys(errors).find((key) => key.startsWith(`${field}[`));
    if (item) return item;
  }
  return null;
}

/** The control to focus for an error key. */
function focusTargetId(key) {
  const feature = /^features\[(\d+)\]/.exec(key);
  if (feature) return `${controlId('features')}-${feature[1]}`;
  if (key === 'features') return `${controlId('features')}-0`;
  if (key.startsWith('technologies')) return controlId('technologies');
  return controlId(key);
}

const technologiesError = (errors) => {
  const key = Object.keys(errors).find((k) => k === 'technologies' || k.startsWith('technologies['));
  return key ? errors[key] : null;
};

const isUnauthorized = (error) => error instanceof ApiError && error.status === 401;

/**
 * Create and edit form for Projects at `/admin/projects/new` and `/admin/projects/:id/edit`
 * (Requirements 13.2, 31.3, 31.7, 31.8, 31.10, 31.11, 31.13, 31.15, 31.16).
 *
 * Edit loads the Project through `GET /api/admin/projects/:id` and pre-fills every field; a
 * failed load shows an error with Retry (not for 404) and a link back to the list. Technology
 * suggestions come from `GET /api/technologies`; when that request fails the input still works
 * without suggestions. The form itself is in ProjectForm.
 */
export default function ProjectFormPage() {
  const { id } = useParams();
  const isEdit = id !== undefined;
  const heading = isEdit ? 'Edit project' : 'New project';
  usePageTitle(heading, ADMIN_TITLE_SUFFIX);

  const project = useFetch((signal) => projectsApi.getAdmin(id, { signal }), [id], { enabled: isEdit });
  const technologies = useFetch((signal) => technologiesApi.list({ signal }), []);
  const suggestions = useMemo(
    () =>
      Array.isArray(technologies.data)
        ? technologies.data.map((t) => (typeof t === 'string' ? t : t?.name)).filter((n) => typeof n === 'string')
        : [],
    [technologies.data],
  );

  let body;
  if (!isEdit) {
    body = <ProjectForm key="new" saved={null} suggestions={suggestions} />;
  } else if (project.loading || isUnauthorized(project.error)) {
    body = <LoadingIndicator label="Loading project…" />;
  } else if (project.error) {
    const notFound = project.error instanceof ApiError && project.error.status === 404;
    body = (
      <ErrorState
        message={notFound ? 'This project was not found. It may have been deleted.' : failureMessage(project.error)}
        onRetry={notFound ? undefined : project.retry}
      >
        <Link to={PROJECTS_LIST_PATH} className="btn btn--secondary">
          Back to projects
        </Link>
      </ErrorState>
    );
  } else {
    body = <ProjectForm key={`edit-${id}`} saved={project.data} suggestions={suggestions} />;
  }

  return (
    <div className="admin-project-form">
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">{heading}</h1>
        <div className="admin-page-header__actions">
          <Link to={PROJECTS_LIST_PATH} className="btn btn--ghost">
            Back to projects
          </Link>
        </div>
      </div>
      {body}
    </div>
  );
}

/**
 * The project form. `saved` is the loaded AdminProject (edit) or null (create).
 *
 * Submit runs `validateProject` on every field and sends nothing while any field fails; each
 * error is shown next to its field and focus moves to the first one (31.7). Features use the
 * ListEditor (keyboard add, remove, reorder; sent in the order shown) and Technologies the
 * TagInput (suggestions, no empty or case-insensitive duplicate names) (31.8).
 *
 * For a Published_Project whose Slug field differs from the saved Slug, a dialog warns that the
 * public URL will change; `PUT` is sent only after Continue, and Cancel keeps the form as it
 * is (31.10). While the request runs the submit button is disabled (31.13).
 *
 * Success: a Notification naming the action, then the list page, which loads the list from the
 * API_Server (31.11). Failure (not 401): an error Notification with the Error_Response message
 * or the network message; for 400 `details` (and the 409 Slug conflict) the errors are shown
 * next to the fields; all values stay in the form (31.15, 31.16).
 */
function ProjectForm({ saved, suggestions }) {
  const isEdit = saved !== null;
  const navigate = useNavigate();
  const { notify } = useNotify();
  const [values, setValues] = useState(() => (isEdit ? valuesFromProject(saved) : { ...EMPTY_VALUES }));
  const [errors, setErrors] = useState({});
  const [focusRequest, setFocusRequest] = useState(null);
  const [pendingPayload, setPendingPayload] = useState(null); // valid payload awaiting the slug warning

  const { run, pending } = useAsyncAction((payload) =>
    isEdit ? projectsApi.update(saved.id, payload) : projectsApi.create(payload),
  );

  useEffect(() => {
    if (!focusRequest) return;
    document.getElementById(focusTargetId(focusRequest.key))?.focus();
  }, [focusRequest]);

  const set = (field, value) => setValues((current) => ({ ...current, [field]: value }));

  const showErrors = (next) => {
    setErrors(next);
    const key = firstErrorKey(next);
    if (key) setFocusRequest({ key });
  };

  const send = async (payload) => {
    const outcome = await run(payload);
    if (outcome.status === 'success') {
      const title = outcome.data?.title ?? payload.title;
      notify({ type: 'success', message: `Project "${title}" ${isEdit ? 'updated' : 'created'}.` });
      navigate(PROJECTS_LIST_PATH);
      return;
    }
    if (outcome.status !== 'error' || isUnauthorized(outcome.error)) return;

    const { error } = outcome;
    if (error instanceof ApiError && error.status === 400) {
      const fieldErrors = errorsFromDetails(error.details);
      if (Object.keys(fieldErrors).length > 0) showErrors(fieldErrors);
    } else if (error instanceof ApiError && error.status === 409) {
      showErrors({ slug: failureMessage(error) });
    }
    notify({ type: 'error', message: failureMessage(error) });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (pending) return;

    const result = validateProject(values);
    if (!result.valid) {
      showErrors(result.errors);
      return;
    }
    setErrors({});
    if (isEdit && needsSlugWarning(saved, result.values.slug)) {
      setPendingPayload(result.values);
      return;
    }
    send(result.values);
  };

  const continueSlugChange = () => {
    const payload = pendingPayload;
    setPendingPayload(null);
    if (payload) send(payload);
  };

  const slugHint = isEdit
    ? 'Lowercase letters, digits and hyphens. Leave empty to keep the current slug.'
    : 'Lowercase letters, digits and hyphens. Leave empty to generate it from the title.';

  return (
    <form className="form admin-form admin-panel" noValidate onSubmit={handleSubmit}>
      {errors[FORM_ERROR_KEY] ? (
        <p className="form-error" role="alert">
          {errors[FORM_ERROR_KEY]}
        </p>
      ) : null}

      <div className="form-grid">
        {TEXT_FIELDS.map((field) => (
          <FormField
            key={field.name}
            id={controlId(field.name)}
            label={field.label}
            required={field.required}
            hint={field.name === 'slug' ? slugHint : (field.hint ?? (field.multiline ? 'Up to 10000 characters' : null))}
            error={errors[field.name]}
            className={field.multiline ? 'form-grid__full' : undefined}
          >
            {(controlProps) =>
              field.multiline ? (
                <textarea
                  {...controlProps}
                  className="form-control admin-project-form__textarea"
                  name={field.name}
                  rows={field.rows ?? 5}
                  value={values[field.name]}
                  onChange={(event) => set(field.name, event.target.value)}
                />
              ) : (
                <input
                  {...controlProps}
                  className="form-control"
                  type={field.type ?? 'text'}
                  name={field.name}
                  inputMode={field.type === 'url' ? 'url' : undefined}
                  value={values[field.name]}
                  onChange={(event) => set(field.name, event.target.value)}
                />
              )
            }
          </FormField>
        ))}

        <FormField
          id={controlId('display_order')}
          label="Display order"
          required
          hint={`A whole number from ${DISPLAY_ORDER_MIN} to ${DISPLAY_ORDER_MAX}; lower numbers come first`}
          error={errors.display_order}
        >
          {(controlProps) => (
            <input
              {...controlProps}
              className="form-control"
              type="number"
              name="display_order"
              min={DISPLAY_ORDER_MIN}
              max={DISPLAY_ORDER_MAX}
              step={1}
              value={values.display_order}
              onChange={(event) => set('display_order', event.target.value)}
            />
          )}
        </FormField>

        <div className="form-field admin-project-form__published">
          <label className="checkbox" htmlFor={controlId('is_published')}>
            <input
              id={controlId('is_published')}
              type="checkbox"
              name="is_published"
              checked={values.is_published}
              onChange={(event) => set('is_published', event.target.checked)}
              aria-invalid={errors.is_published ? 'true' : undefined}
              aria-describedby={errors.is_published ? `${controlId('is_published')}-error` : undefined}
            />
            <span>Published (visible on the public site)</span>
          </label>
          {errors.is_published ? (
            <p id={`${controlId('is_published')}-error`} className="form-field__error">
              {errors.is_published}
            </p>
          ) : null}
        </div>

        <ListEditor
          id={controlId('features')}
          name="features"
          label="Features"
          itemLabel="Feature"
          items={values.features}
          onChange={(features) => set('features', features)}
          maxItems={PROJECT_FEATURES_MAX}
          hint="Each feature up to 300 characters, in the order shown on the project page"
          errors={errors}
          className="form-grid__full"
        />

        <TagInput
          id={controlId('technologies')}
          label="Technologies"
          tags={values.technologies}
          onChange={(technologies) => {
            set('technologies', technologies);
            setErrors((current) => {
              if (!technologiesError(current)) return current;
              return Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('technologies')));
            });
          }}
          suggestions={suggestions}
          max={PROJECT_TECHNOLOGIES_MAX}
          error={technologiesError(errors)}
          hint={`Up to ${PROJECT_TECHNOLOGIES_MAX} names. Press Enter or select Add to add a name.`}
          className="form-grid__full"
        />
      </div>

      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending ? 'true' : undefined}>
          {pending ? SAVING_LABEL : isEdit ? 'Save changes' : 'Create project'}
        </button>
        <Link to={PROJECTS_LIST_PATH} className="btn btn--secondary">
          Cancel
        </Link>
      </div>

      <ConfirmDialog
        open={pendingPayload !== null}
        title={SLUG_WARNING_TITLE}
        message={
          pendingPayload
            ? `This project is published. Changing its slug from "${saved?.slug}" to "${pendingPayload.slug}" changes its public URL, and links to the old URL will stop working.`
            : undefined
        }
        confirmLabel="Continue"
        cancelLabel="Cancel"
        onConfirm={continueSlugChange}
        onCancel={() => setPendingPayload(null)}
      />
    </form>
  );
}
