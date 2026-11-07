import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { resolvePostLoginPath } from '../../context/authPaths.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { FormField, hasText } from '../../components/common/index.js';
import {
  LOGIN_FIELD_ORDER,
  errorsFromDetails,
  firstInvalidField,
  validateLogin,
} from '../../utils/validation.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import '../../styles/pages/login.css';

export const LOGIN_INVALID_MESSAGE = 'Invalid email or password.';
export const LOGIN_RATE_LIMIT_MESSAGE = 'Too many login attempts. Please try again later.';
export const LOGIN_UNAVAILABLE_MESSAGE = 'Sign-in could not be completed. Please try again.';
export const LOGIN_PENDING_LABEL = 'Signing in…';

const EMPTY_VALUES = Object.freeze({ email: '', password: '' });

const FIELDS = [
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'username' },
  { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
];

const controlId = (field) => `login-${field}`;

/** Keeps only the errors that name the email or password field. */
const pickFieldErrors = (errors) =>
  Object.fromEntries(Object.entries(errors).filter(([field]) => LOGIN_FIELD_ORDER.includes(field)));

const messageOr = (error, fallback) =>
  error instanceof ApiError && hasText(error.message) ? error.message : fallback;

/**
 * Admin login page at `/admin/login` (Requirement 30). Rendered by GuestOnlyRoute, outside the
 * AdminLayout, so it has its own `main` and `h1`.
 *
 * - Form: labelled email and masked password fields (30.1). Submit runs `validateLogin`; an empty
 *   or invalid email or an empty password shows an error next to the field, focuses the first
 *   invalid one and sends no request (30.2).
 * - Pending: one request through `useAsyncAction`; the button is disabled, `aria-busy` and
 *   labelled "Signing in…", and further submits are ignored (30.8).
 * - Outcome:
 *   200 → `navigate(resolvePostLoginPath(from), { replace: true })`, where `from` is the
 *         ProtectedRoute's `location.state.from`, else the path remembered at a session expiry (30.3).
 *   401 / 429 → the Error_Response message, password cleared, email kept (30.4, 8.8).
 *   400 → `details` shown next to the matching fields, values kept (30.9).
 *   network error, no response or status ≥ 500 → an error Notification, values kept (30.10).
 *   Any other Error_Response → its message in a form-level alert.
 *   Auth_Context stores the token only on success, so failures leave it unauthenticated.
 * - Session expiry (6.4): the Auth_Context message is copied into local state at mount and then
 *   cleared in the context, so it shows once on this visit and never again after a later visit
 *   or a successful login. The local copy is hidden when the next attempt starts.
 */
export default function LoginPage() {
  usePageTitle('Sign in', ADMIN_TITLE_SUFFIX);
  const { login, sessionMessage, sessionFrom, clearSessionMessage } = useAuth();
  const { notify } = useNotify();
  const location = useLocation();
  const navigate = useNavigate();
  const { run, pending } = useAsyncAction(login);

  // Captured at mount, before the context values are cleared below.
  const [from] = useState(() => location.state?.from ?? sessionFrom);
  const [notice, setNotice] = useState(() => sessionMessage);

  const [values, setValues] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const controlRefs = useRef({});

  useEffect(() => {
    if (sessionMessage !== null || sessionFrom !== null) clearSessionMessage();
  }, [sessionMessage, sessionFrom, clearSessionMessage]);

  // Focus after the render that adds aria-invalid and the error text, so both are read out.
  useEffect(() => {
    if (focusRequest) controlRefs.current[focusRequest.field]?.focus();
  }, [focusRequest]);

  const update = (field) => (event) => {
    const { value } = event.target;
    setValues((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (pending) return;

    setNotice(null);
    setFormError(null);

    const result = validateLogin(values);
    if (!result.valid) {
      const fieldErrors = pickFieldErrors(result.errors);
      setErrors(fieldErrors);
      const field = firstInvalidField(fieldErrors, LOGIN_FIELD_ORDER);
      if (field) setFocusRequest({ field });
      return;
    }

    setErrors({});
    const target = resolvePostLoginPath(from);
    const outcome = await run(result.values.email, result.values.password);

    if (outcome.status === 'success') {
      navigate(target, { replace: true });
      return;
    }
    if (outcome.status !== 'error') return;

    const { error } = outcome;
    const status = error instanceof ApiError ? error.status : undefined;

    if (status === 401 || status === 429) {
      setValues((current) => ({ ...current, password: '' }));
      setFormError(messageOr(error, status === 429 ? LOGIN_RATE_LIMIT_MESSAGE : LOGIN_INVALID_MESSAGE));
      setFocusRequest({ field: 'password' });
    } else if (status === 400) {
      const fieldErrors = pickFieldErrors(errorsFromDetails(error.details));
      setErrors(fieldErrors);
      const field = firstInvalidField(fieldErrors, LOGIN_FIELD_ORDER);
      if (field) setFocusRequest({ field });
      else setFormError(messageOr(error, LOGIN_UNAVAILABLE_MESSAGE));
    } else if (status === undefined || status === 0 || status >= 500) {
      notify({ type: 'error', message: LOGIN_UNAVAILABLE_MESSAGE });
    } else {
      setFormError(messageOr(error, LOGIN_UNAVAILABLE_MESSAGE));
    }
  };

  return (
    <main id="main" tabIndex={-1} className="login-page">
      <div className="login-card">
        <h1 className="login-card__title">Sign in</h1>

        {notice ? (
          <p className="login-notice" role="alert">
            {notice}
          </p>
        ) : null}

        <form className="form login-form" noValidate onSubmit={handleSubmit}>
          {FIELDS.map((field) => (
            <FormField
              key={field.name}
              id={controlId(field.name)}
              label={field.label}
              error={errors[field.name]}
              required
            >
              {(controlProps) => (
                <input
                  {...controlProps}
                  ref={(el) => {
                    controlRefs.current[field.name] = el;
                  }}
                  className="form-control"
                  type={field.type}
                  name={field.name}
                  autoComplete={field.autoComplete}
                  value={values[field.name]}
                  onChange={update(field.name)}
                />
              )}
            </FormField>
          ))}

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
              {pending ? LOGIN_PENDING_LABEL : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
