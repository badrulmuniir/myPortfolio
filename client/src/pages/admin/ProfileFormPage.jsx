import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/apiClient.js';
import * as profileApi from '../../api/profileApi.js';
import { ErrorState, FormField, LoadingIndicator } from '../../components/common/index.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { errorsFromDetails, firstInvalidField, validateProfile } from '../../utils/validation.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import { errorMessageOr } from './EducationListPage.jsx';
import { isUnauthorized } from './ExperienceListPage.jsx';
import '../../styles/pages/admin-profile.css';

export const PROFILE_HEADING = 'Profile';
export const PROFILE_LOADING_LABEL = 'Loading profile…';
export const PROFILE_LOAD_ERROR_TITLE = 'The profile could not be loaded.';
export const PROFILE_MISSING_TITLE = 'No profile exists yet.';
export const PROFILE_MISSING_MESSAGE =
  'The profile record has not been created. Run the seed script on the server (npm run seed in the server folder), then select Retry.';
export const PROFILE_SAVED_MESSAGE = 'Profile saved.';
export const PROFILE_SAVE_FAILED_MESSAGE = 'The profile could not be saved. Please try again.';
export const PROFILE_SAVING_LABEL = 'Saving…';
export const PROFILE_SUBMIT_LABEL = 'Save profile';

/** The ten Profile fields (10.1) in display order; also the order used to focus the first error. */
export const PROFILE_FIELD_ORDER = Object.freeze([
  'name',
  'professional_title',
  'email',
  'personal_introduction',
  'biography',
  'career_interests',
  'professional_goals',
  'profile_image_url',
  'github_url',
  'linkedin_url',
]);

const controlId = (field) => `profile-${field.replaceAll('_', '-')}`;

/** Form values for a Profile object: every one of the ten fields as a string ('' when missing). */
export const valuesFromProfile = (profile) =>
  Object.fromEntries(
    PROFILE_FIELD_ORDER.map((field) => {
      const value = profile?.[field];
      return [field, typeof value === 'string' ? value : ''];
    }),
  );

const splitErrors = (errors) => {
  const fieldErrors = {};
  const other = [];
  for (const [field, message] of Object.entries(errors)) {
    if (PROFILE_FIELD_ORDER.includes(field)) fieldErrors[field] = message;
    else other.push(message);
  }
  return { fieldErrors, other };
};

const isNotFound = (error) => error instanceof ApiError && error.status === 404;

/**
 * Profile form at `/admin/profile` (Requirements 10.6, 10.7, 10.8, 10.11, 31.13).
 *
 * The page requests `GET /api/profile` and renders the form only after the response arrives,
 * so the submit button is never enabled before all ten fields hold the returned values (10.11).
 * While loading it shows a LoadingIndicator; a failed request shows an error with Retry. A 404
 * means the single Profile row does not exist; `PUT /api/profile` would also return 404 (10.12),
 * so the page explains how to create it (seed script) instead of showing a form that cannot save.
 * A 401 is left to the Auth_Context, which returns to the login page.
 */
export default function ProfileFormPage() {
  usePageTitle(PROFILE_HEADING, ADMIN_TITLE_SUFFIX);
  const { loading, data, error, retry } = useFetch((signal) => profileApi.get({ signal }), []);

  let content;
  if (loading || isUnauthorized(error)) {
    content = <LoadingIndicator label={PROFILE_LOADING_LABEL} />;
  } else if (isNotFound(error)) {
    content = <ErrorState title={PROFILE_MISSING_TITLE} message={PROFILE_MISSING_MESSAGE} onRetry={retry} />;
  } else if (error) {
    content = <ErrorState title={PROFILE_LOAD_ERROR_TITLE} message={error?.message} onRetry={retry} />;
  } else {
    content = <ProfileForm initialValues={valuesFromProfile(data)} />;
  }

  return (
    <>
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">{PROFILE_HEADING}</h1>
      </div>
      {content}
    </>
  );
}

/**
 * The form itself.
 *
 * - Submit runs `validateProfile` first (name, professional title and email required, length
 *   limits, Valid_Email, URLs empty or Valid_URL). A failure shows a field error next to each
 *   failing field, focuses the first one and sends no request.
 * - Otherwise all ten trimmed fields go to `PUT /api/profile`; the submit button is disabled
 *   and labelled "Saving…" until the response arrives (10.6, 31.13).
 * - 200: success Notification and the form is filled with the returned Profile (10.7).
 * - Any other failure except 401: error Notification with the Error_Response message or the
 *   network message; the entered values stay, and each `details` field error is shown next to
 *   its field (10.8). Errors that match no field are shown above the actions.
 */
function ProfileForm({ initialValues }) {
  const { notify } = useNotify();
  const { run, pending } = useAsyncAction((payload) => profileApi.update(payload));

  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const controlRefs = useRef({});

  // Focus after the render that adds aria-invalid and the error text, so both are announced.
  useEffect(() => {
    if (focusRequest) controlRefs.current[focusRequest.field]?.focus();
  }, [focusRequest]);

  const update = (field) => (event) => {
    const { value } = event.target;
    setValues((current) => ({ ...current, [field]: value }));
  };

  const showErrors = (fieldErrors, other = []) => {
    setErrors(fieldErrors);
    setFormError(other.length > 0 ? other.join(' ') : null);
    const field = firstInvalidField(fieldErrors, PROFILE_FIELD_ORDER);
    if (field) setFocusRequest({ field });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (pending) return;

    const result = validateProfile(values);
    if (!result.valid) {
      const { fieldErrors, other } = splitErrors(result.errors);
      showErrors(fieldErrors, other);
      return;
    }

    setErrors({});
    setFormError(null);
    // Every field is present in `values`, so the payload holds all ten trimmed fields (10.6).
    const outcome = await run(result.values);
    if (outcome.status === 'ignored') return;

    if (outcome.status === 'success') {
      setValues(valuesFromProfile(outcome.data));
      notify({ type: 'success', message: PROFILE_SAVED_MESSAGE });
      return;
    }

    const { error } = outcome;
    if (isUnauthorized(error)) return; // session expiry is handled by the Auth_Context

    if (error instanceof ApiError && error.status === 400) {
      const { fieldErrors, other } = splitErrors(errorsFromDetails(error.details));
      showErrors(fieldErrors, other);
    }
    notify({ type: 'error', message: errorMessageOr(error, PROFILE_SAVE_FAILED_MESSAGE) });
  };

  const setRef = (field) => (el) => {
    controlRefs.current[field] = el;
  };

  const input = (field, label, { required = false, hint, type = 'text', autoComplete } = {}) => (
    <FormField id={controlId(field)} label={label} error={errors[field]} hint={hint} required={required}>
      {(controlProps) => (
        <input
          {...controlProps}
          ref={setRef(field)}
          className="form-control"
          type={type}
          name={field}
          autoComplete={autoComplete}
          value={values[field]}
          onChange={update(field)}
        />
      )}
    </FormField>
  );

  const textarea = (field, label) => (
    <FormField
      id={controlId(field)}
      label={label}
      error={errors[field]}
      hint="Optional, up to 5000 characters. Line breaks are kept."
      className="form-grid__full"
    >
      {(controlProps) => (
        <textarea
          {...controlProps}
          ref={setRef(field)}
          className="form-control"
          name={field}
          rows={5}
          value={values[field]}
          onChange={update(field)}
        />
      )}
    </FormField>
  );

  const urlHint = 'Optional. A full http or https URL; leave empty to remove it.';

  return (
    <form className="form admin-form admin-panel admin-profile-form" noValidate onSubmit={handleSubmit}>
      <fieldset className="admin-profile-form__section">
        <legend className="admin-profile-form__legend">Basic details</legend>
        <div className="form-grid">
          {input('name', 'Name', { required: true, hint: 'Up to 100 characters', autoComplete: 'name' })}
          {input('professional_title', 'Professional title', { required: true, hint: 'Up to 100 characters' })}
          <div className="form-grid__full">
            {input('email', 'Email', { required: true, type: 'email', autoComplete: 'email' })}
          </div>
        </div>
      </fieldset>

      <fieldset className="admin-profile-form__section">
        <legend className="admin-profile-form__legend">About</legend>
        <div className="form-grid">
          {textarea('personal_introduction', 'Personal introduction')}
          {textarea('biography', 'Biography')}
          {textarea('career_interests', 'Career interests')}
          {textarea('professional_goals', 'Professional goals')}
        </div>
      </fieldset>

      <fieldset className="admin-profile-form__section">
        <legend className="admin-profile-form__legend">Image and links</legend>
        <div className="form-grid">
          <div className="form-grid__full">
            {input('profile_image_url', 'Profile image URL', { type: 'url', hint: urlHint })}
          </div>
          {input('github_url', 'GitHub URL', { type: 'url', hint: urlHint })}
          {input('linkedin_url', 'LinkedIn URL', { type: 'url', hint: urlHint })}
        </div>
      </fieldset>

      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending ? 'true' : undefined}>
          {pending ? PROFILE_SAVING_LABEL : PROFILE_SUBMIT_LABEL}
        </button>
      </div>
    </form>
  );
}
