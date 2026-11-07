import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/apiClient.js';
import * as experiencesApi from '../../api/experiencesApi.js';
import { ListEditor } from '../../components/admin/index.js';
import { EmptyState, ErrorState, FormField, LoadingIndicator } from '../../components/common/index.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import {
  EMPLOYMENT_TYPES,
  FORM_ERROR_KEY,
  RESPONSIBILITIES_MAX,
  errorsFromDetails,
  isIsoDate,
  validateExperience,
} from '../../utils/validation.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import { EXPERIENCE_BASE_PATH, isUnauthorized } from './ExperienceListPage.jsx';
import '../../styles/pages/admin-experience.css';

export const NEW_EXPERIENCE_HEADING = 'New experience entry';
export const EDIT_EXPERIENCE_HEADING = 'Edit experience entry';
export const EXPERIENCE_NOT_FOUND_MESSAGE = 'This experience entry does not exist. It may have been deleted.';
export const EXPERIENCE_CREATED_MESSAGE = 'Experience entry created.';
export const EXPERIENCE_UPDATED_MESSAGE = 'Experience entry updated.';
export const END_BEFORE_START_MESSAGE = 'End date must not be before the start date';
export const EXPERIENCE_SAVING_LABEL = 'Saving…';
export const EMPLOYMENT_TYPE_REQUIRED_MESSAGE = 'Select an employment type';

/** Form fields in display order; also the order used to focus the first invalid field. */
export const EXPERIENCE_FIELD_ORDER = Object.freeze([
  'job_title',
  'company_name',
  'employment_type',
  'start_date',
  'end_date',
  'description',
  'responsibilities',
]);

const EMPTY_VALUES = Object.freeze({
  job_title: '',
  company_name: '',
  employment_type: '',
  start_date: '',
  end_date: '',
  description: '',
  responsibilities: [],
});

const RESPONSIBILITY_KEY = /^responsibilities\[(\d+)\]$/;

const controlId = (field) => {
  const item = RESPONSIBILITY_KEY.exec(field);
  if (item) return `experience-responsibilities-${item[1]}`;
  return `experience-${field.replaceAll('_', '-')}`;
};

const isFieldKey = (key) => EXPERIENCE_FIELD_ORDER.includes(key) || RESPONSIBILITY_KEY.test(key);

/** Form values for a stored Experience_Record. */
export const toFormValues = (experience) => ({
  job_title: experience.job_title ?? '',
  company_name: experience.company_name ?? '',
  employment_type: experience.employment_type ?? '',
  start_date: experience.start_date ?? '',
  end_date: experience.end_date ?? '',
  description: experience.description ?? '',
  responsibilities: Array.isArray(experience.responsibilities) ? [...experience.responsibilities] : [],
});

/**
 * Validates the form (31.7). `validateExperience` checks the end date against the start date
 * only once every other field passes; here the check also runs when other fields fail, so every
 * failing field shows its error after one submit.
 *
 * @returns {{ valid: true, payload: object } | { valid: false, errors: Record<string, string> }}
 */
export function checkExperienceForm(values) {
  const result = validateExperience(values);
  if (result.valid) {
    // The form always sends every field (end_date null for a current role).
    return { valid: true, payload: { ...result.values, end_date: result.values.end_date ?? null } };
  }
  const errors = { ...result.errors };
  if (errors.employment_type && values.employment_type === '') errors.employment_type = EMPLOYMENT_TYPE_REQUIRED_MESSAGE;
  const start = typeof values.start_date === 'string' ? values.start_date.trim() : '';
  const end = typeof values.end_date === 'string' ? values.end_date.trim() : '';
  if (!errors.end_date && isIsoDate(start) && isIsoDate(end) && end < start) {
    errors.end_date = END_BEFORE_START_MESSAGE;
  }
  return { valid: false, errors };
}

/** The first field with an error in display order, responsibility items by index. */
function firstErrorKey(errors) {
  for (const field of EXPERIENCE_FIELD_ORDER) {
    if (field === 'responsibilities') {
      const items = Object.keys(errors)
        .map((key) => RESPONSIBILITY_KEY.exec(key))
        .filter(Boolean)
        .map((match) => Number(match[1]))
        .sort((a, b) => a - b);
      if (items.length > 0) return `responsibilities[${items[0]}]`;
    }
    if (Object.hasOwn(errors, field)) return field;
  }
  return null;
}

/**
 * Admin experience form for `/admin/experience/new` and `/admin/experience/:id/edit`
 * (Requirements 16.3, 16.4, 16.6, 31.3, 31.7, 31.9, 31.11, 31.13, 31.15, 31.16).
 *
 * There is no get-by-id endpoint, so the edit page loads `GET /api/experiences` and picks the
 * record by id; a missing id shows a not-found state.
 */
export default function ExperienceFormPage() {
  const { id } = useParams();
  const isEdit = id !== undefined;
  const heading = isEdit ? EDIT_EXPERIENCE_HEADING : NEW_EXPERIENCE_HEADING;
  usePageTitle(heading, ADMIN_TITLE_SUFFIX);

  const { loading, data, error, retry } = useFetch((signal) => experiencesApi.list({ signal }), [id], {
    enabled: isEdit,
  });

  let content;
  if (!isEdit) {
    content = <ExperienceForm initialValues={EMPTY_VALUES} />;
  } else if (loading || isUnauthorized(error)) {
    content = <LoadingIndicator label="Loading experience entry…" />;
  } else if (error) {
    content = <ErrorState message={error.message} onRetry={retry} />;
  } else {
    const record = Array.isArray(data) ? data.find((item) => String(item.id) === id) : undefined;
    content = record ? (
      <ExperienceForm key={record.id} experienceId={record.id} initialValues={toFormValues(record)} />
    ) : (
      <EmptyState title="Experience entry not found" message={EXPERIENCE_NOT_FOUND_MESSAGE}>
        <Link to={EXPERIENCE_BASE_PATH} className="btn btn--secondary">
          Back to experience
        </Link>
      </EmptyState>
    );
  }

  return (
    <>
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">{heading}</h1>
      </div>
      {content}
    </>
  );
}

function ExperienceForm({ experienceId, initialValues }) {
  const isEdit = experienceId !== undefined;
  const navigate = useNavigate();
  const { notify } = useNotify();
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [focusRequest, setFocusRequest] = useState(null);
  const { run, pending } = useAsyncAction((payload) =>
    isEdit ? experiencesApi.update(experienceId, payload) : experiencesApi.create(payload),
  );

  // Focus after the render that shows the error text, so it is read out with the field.
  useEffect(() => {
    if (focusRequest) document.getElementById(controlId(focusRequest.field))?.focus();
  }, [focusRequest]);

  const showErrors = (nextErrors) => {
    setErrors(nextErrors);
    const field = firstErrorKey(nextErrors);
    if (field) setFocusRequest({ field });
  };

  const update = (field) => (event) => {
    const { value } = event.target;
    setValues((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (pending) return;

    const checked = checkExperienceForm(values);
    if (!checked.valid) {
      showErrors(checked.errors);
      return;
    }

    setErrors({});
    const outcome = await run(checked.payload);
    if (outcome.status === 'ignored') return;

    if (outcome.status === 'success') {
      notify({ type: 'success', message: isEdit ? EXPERIENCE_UPDATED_MESSAGE : EXPERIENCE_CREATED_MESSAGE });
      navigate(EXPERIENCE_BASE_PATH); // the list page reloads from the API_Server (31.11)
      return;
    }

    const { error } = outcome;
    if (isUnauthorized(error)) return;
    if (error instanceof ApiError && error.status === 400) {
      const serverErrors = errorsFromDetails(error.details);
      const fieldErrors = Object.fromEntries(Object.entries(serverErrors).filter(([key]) => isFieldKey(key)));
      const other = Object.entries(serverErrors).filter(([key]) => !isFieldKey(key));
      if (other.length > 0 || Object.keys(fieldErrors).length === 0) {
        fieldErrors[FORM_ERROR_KEY] = other.length > 0 ? other.map(([, message]) => message).join(' ') : error.message;
      }
      showErrors(fieldErrors);
      return;
    }
    notify({ type: 'error', message: error?.message || 'The experience entry could not be saved.' });
  };

  const textField = (field, label, { required = false, hint, type = 'text' } = {}) => (
    <FormField id={controlId(field)} label={label} required={required} hint={hint} error={errors[field]}>
      {(controlProps) => (
        <input
          {...controlProps}
          className="form-control"
          type={type}
          name={field}
          value={values[field]}
          onChange={update(field)}
        />
      )}
    </FormField>
  );

  return (
    <form className="form admin-form admin-experience-form" noValidate onSubmit={handleSubmit}>
      <div className="form-grid">
        {textField('job_title', 'Job title', { required: true, hint: 'Up to 100 characters' })}
        {textField('company_name', 'Company', { required: true, hint: 'Up to 100 characters' })}

        <FormField
          id={controlId('employment_type')}
          label="Employment type"
          required
          error={errors.employment_type}
        >
          {(controlProps) => (
            <select
              {...controlProps}
              className="form-control"
              name="employment_type"
              value={values.employment_type}
              onChange={update('employment_type')}
            >
              <option value="">Select a type</option>
              {EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <div className="admin-experience-form__dates">
          {textField('start_date', 'Start date', { required: true, type: 'date' })}
          {textField('end_date', 'End date', {
            type: 'date',
            hint: 'Leave empty for a current role. Must not be before the start date.',
          })}
        </div>

        <FormField
          id={controlId('description')}
          label="Description"
          hint="Up to 5000 characters"
          error={errors.description}
          className="form-grid__full"
        >
          {(controlProps) => (
            <textarea
              {...controlProps}
              className="form-control"
              name="description"
              rows={6}
              value={values.description}
              onChange={update('description')}
            />
          )}
        </FormField>

        <ListEditor
          id="experience-responsibilities"
          name="responsibilities"
          label="Responsibilities"
          itemLabel="Responsibility"
          addLabel="Add responsibility"
          hint="Each item up to 300 characters, shown in this order."
          maxItems={RESPONSIBILITIES_MAX}
          items={values.responsibilities}
          onChange={(responsibilities) => setValues((current) => ({ ...current, responsibilities }))}
          errors={errors}
          className="form-grid__full"
        />
      </div>

      {errors[FORM_ERROR_KEY] ? (
        <p className="form-error" role="alert">
          {errors[FORM_ERROR_KEY]}
        </p>
      ) : null}

      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending ? 'true' : undefined}>
          {pending ? EXPERIENCE_SAVING_LABEL : isEdit ? 'Save changes' : 'Create experience entry'}
        </button>
        <Link to={EXPERIENCE_BASE_PATH} className="btn btn--secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
