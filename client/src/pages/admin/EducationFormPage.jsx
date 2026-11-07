import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/apiClient.js';
import * as educationApi from '../../api/educationApi.js';
import { EmptyState, ErrorState, FormField, LoadingIndicator } from '../../components/common/index.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import {
  EDUCATION_MIN_YEAR,
  EDUCATION_YEARS_AHEAD,
  errorsFromDetails,
  firstInvalidField,
  validateEducation,
} from '../../utils/validation.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import { EDUCATION_LIST_PATH, educationName, errorMessageOr } from './EducationListPage.jsx';
import '../../styles/pages/admin-education.css';

export const EDUCATION_NEW_HEADING = 'New education record';
export const EDUCATION_EDIT_HEADING = 'Edit education record';
export const EDUCATION_NOT_FOUND_HEADING = 'Education record not found';
export const EDUCATION_NOT_FOUND_MESSAGE = 'This education record does not exist. It may have been deleted.';
export const EDUCATION_LOAD_ERROR_TITLE = 'The education record could not be loaded.';
export const EDUCATION_SAVE_FAILED_MESSAGE = 'The education record could not be saved. Please try again.';
export const EDUCATION_SAVING_LABEL = 'Saving…';

/** Form fields in display order; also the order used to focus the first invalid field. */
export const EDUCATION_FIELD_ORDER = Object.freeze([
  'institution',
  'qualification',
  'field_of_study',
  'start_year',
  'end_year',
  'description',
]);

const EMPTY_VALUES = Object.freeze({
  institution: '',
  qualification: '',
  field_of_study: '',
  start_year: '',
  end_year: '',
  description: '',
});

const controlId = (field) => `education-${field}`;

const yearText = (value) => (value === null || value === undefined ? '' : String(value));
const text = (value) => (typeof value === 'string' ? value : '');

/** Form values for a saved Education_Record: years as input strings, no end year as ''. */
export const valuesFromRecord = (record) => ({
  institution: text(record.institution),
  qualification: text(record.qualification),
  field_of_study: text(record.field_of_study),
  start_year: yearText(record.start_year),
  end_year: yearText(record.end_year),
  description: text(record.description),
});

/** Latest allowed start or end year: the current UTC year plus 10 (17.3). */
const maxYear = () => new Date().getUTCFullYear() + EDUCATION_YEARS_AHEAD;

const splitErrors = (errors) => {
  const fieldErrors = {};
  const other = [];
  for (const [field, message] of Object.entries(errors)) {
    if (EDUCATION_FIELD_ORDER.includes(field)) fieldErrors[field] = message;
    else other.push(message);
  }
  return { fieldErrors, other };
};

/**
 * Create and edit form for Education_Records at `/admin/education/new` and
 * `/admin/education/:id/edit` (Requirements 17.3, 17.4, 31.3, 31.7, 31.11, 31.13, 31.15, 31.16).
 *
 * There is no single-record endpoint, so the edit route loads `GET /api/education` and picks the
 * record whose id matches the route. While loading it shows a LoadingIndicator; a failed request
 * shows an error with Retry; an id that matches no record shows a not-found state with a link
 * back to the list.
 */
export default function EducationFormPage() {
  const { id } = useParams();
  const isEdit = id !== undefined;
  const { loading, data, error, retry } = useFetch((signal) => educationApi.list({ signal }), [id], {
    enabled: isEdit,
  });

  const record = isEdit && Array.isArray(data) ? (data.find((item) => String(item?.id) === id) ?? null) : null;
  const notFound = isEdit && !loading && !error && record === null;

  let heading = EDUCATION_NEW_HEADING;
  if (isEdit) heading = notFound ? EDUCATION_NOT_FOUND_HEADING : EDUCATION_EDIT_HEADING;
  usePageTitle(heading, ADMIN_TITLE_SUFFIX);

  let content;
  if (!isEdit) {
    content = <EducationForm key="new" initialValues={EMPTY_VALUES} />;
  } else if (loading) {
    content = <LoadingIndicator label="Loading education record…" />;
  } else if (error) {
    content = <ErrorState title={EDUCATION_LOAD_ERROR_TITLE} message={error?.message} onRetry={retry} />;
  } else if (notFound) {
    content = (
      <EmptyState message={EDUCATION_NOT_FOUND_MESSAGE}>
        <Link to={EDUCATION_LIST_PATH} className="btn btn--secondary">
          Back to education records
        </Link>
      </EmptyState>
    );
  } else {
    content = <EducationForm key={id} recordId={record.id} initialValues={valuesFromRecord(record)} />;
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

/**
 * The form itself. `recordId` undefined → `POST /api/education`, otherwise
 * `PUT /api/education/:id` with every field.
 *
 * - Submit runs `validateEducation` first (required institution and qualification, length
 *   limits, start year 1950..Y+10, end year empty or start year..Y+10). Any failure shows a
 *   field error next to each failing field, focuses the first one and sends no request (31.7).
 * - One request at a time; the submit button is disabled and labelled "Saving…" (31.13).
 * - Success: success Notification and navigation to the list, which reloads it (31.11).
 * - 400 with `details`: the errors are shown next to the matching fields; all values stay (31.15).
 * - Other failures except 401: error Notification; the form and its values stay (31.16).
 */
function EducationForm({ recordId, initialValues }) {
  const isEdit = recordId !== undefined;
  const navigate = useNavigate();
  const { notify } = useNotify();
  const { run, pending } = useAsyncAction((payload) =>
    isEdit ? educationApi.update(recordId, payload) : educationApi.create(payload),
  );

  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const controlRefs = useRef({});
  const latestYear = maxYear();

  // Focus after the render that adds aria-invalid and the error text, so both are announced.
  useEffect(() => {
    if (focusRequest) controlRefs.current[focusRequest.field]?.focus();
  }, [focusRequest]);

  const update = (field) => (event) => {
    const { value } = event.target;
    setValues((current) => ({ ...current, [field]: value }));
  };

  const showErrors = (fieldErrors) => {
    setErrors(fieldErrors);
    const field = firstInvalidField(fieldErrors, EDUCATION_FIELD_ORDER);
    if (field) setFocusRequest({ field });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (pending) return;
    setFormError(null);

    const result = validateEducation(values);
    if (!result.valid) {
      const { fieldErrors, other } = splitErrors(result.errors);
      showErrors(fieldErrors);
      if (other.length > 0) setFormError(other.join(' '));
      return;
    }

    setErrors({});
    const outcome = await run(result.values);
    if (outcome.status === 'success') {
      const name = educationName(outcome.data ?? result.values);
      notify({
        type: 'success',
        message: isEdit ? `Updated education record "${name}".` : `Created education record "${name}".`,
      });
      navigate(EDUCATION_LIST_PATH);
      return;
    }
    if (outcome.status !== 'error') return;

    const { error } = outcome;
    const status = error instanceof ApiError ? error.status : undefined;
    if (status === 401) return; // session expiry is handled by the Auth_Context

    if (status === 400) {
      const { fieldErrors, other } = splitErrors(errorsFromDetails(error.details));
      if (Object.keys(fieldErrors).length > 0 || other.length > 0) {
        showErrors(fieldErrors);
        if (other.length > 0) setFormError(other.join(' '));
        return;
      }
    }
    notify({ type: 'error', message: errorMessageOr(error, EDUCATION_SAVE_FAILED_MESSAGE) });
  };

  const textInput = (field, label, { required = false, hint } = {}) => (
    <FormField id={controlId(field)} label={label} error={errors[field]} hint={hint} required={required}>
      {(controlProps) => (
        <input
          {...controlProps}
          ref={(el) => {
            controlRefs.current[field] = el;
          }}
          className="form-control"
          type="text"
          name={field}
          value={values[field]}
          onChange={update(field)}
        />
      )}
    </FormField>
  );

  const yearInput = (field, label, { required = false, hint }) => (
    <FormField
      id={controlId(field)}
      label={label}
      error={errors[field]}
      hint={hint}
      required={required}
      className="admin-education-form__year"
    >
      {(controlProps) => (
        <input
          {...controlProps}
          ref={(el) => {
            controlRefs.current[field] = el;
          }}
          className="form-control"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          name={field}
          value={values[field]}
          onChange={update(field)}
        />
      )}
    </FormField>
  );

  return (
    <form className="form admin-form admin-panel admin-education-form" noValidate onSubmit={handleSubmit}>
      <div className="form-grid">
        {textInput('institution', 'Institution', { required: true, hint: 'Up to 150 characters' })}
        {textInput('qualification', 'Qualification', { required: true, hint: 'Up to 150 characters' })}
        <div className="form-grid__full">
          {textInput('field_of_study', 'Field of study', { hint: 'Optional, up to 150 characters' })}
        </div>
        {yearInput('start_year', 'Start year', {
          required: true,
          hint: `A year from ${EDUCATION_MIN_YEAR} to ${latestYear}`,
        })}
        {yearInput('end_year', 'End year', {
          hint: `Leave empty if ongoing. Otherwise a year from the start year to ${latestYear}`,
        })}
        <div className="form-grid__full">
          <FormField
            id={controlId('description')}
            label="Description"
            error={errors.description}
            hint="Optional, up to 5000 characters"
          >
            {(controlProps) => (
              <textarea
                {...controlProps}
                ref={(el) => {
                  controlRefs.current.description = el;
                }}
                className="form-control"
                name="description"
                rows={6}
                value={values.description}
                onChange={update('description')}
              />
            )}
          </FormField>
        </div>
      </div>

      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={pending}
          aria-busy={pending ? 'true' : undefined}
        >
          {pending ? EDUCATION_SAVING_LABEL : isEdit ? 'Save changes' : 'Create education record'}
        </button>
        <Link to={EDUCATION_LIST_PATH} className="btn btn--secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
