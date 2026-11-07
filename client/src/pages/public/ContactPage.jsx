import { useEffect, useRef, useState } from 'react';
import { submit as submitContact } from '../../api/contactApi.js';
import { ApiError } from '../../api/apiClient.js';
import { useSiteData } from '../../context/SiteDataContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { usePublicPageTitle } from '../../hooks/usePublicPageTitle.js';
import { PAGE_NAMES } from '../../components/layout/navItems.js';
import {
  DEFAULT_ERROR_MESSAGE,
  ErrorState,
  FormField,
  LoadingIndicator,
  SafeLink,
  hasText,
} from '../../components/common/index.js';
import { isValidUrl } from '../../utils/url.js';
import {
  CONTACT_FIELD_ORDER,
  HONEYPOT_FIELD,
  errorsFromDetails,
  firstInvalidField,
  validateContact,
} from '../../utils/validation.js';
import '../../styles/pages/contact.css';

export const CONTACT_SUCCESS_MESSAGE = 'Your message has been sent.';
export const CONTACT_RATE_LIMIT_MESSAGE = 'Too many messages sent. Please try again later.';
export const CONTACT_SENDING_LABEL = 'Sending…';

const EMPTY_VALUES = Object.freeze({ name: '', email: '', subject: '', message: '', [HONEYPOT_FIELD]: '' });

const FIELDS = [
  { name: 'name', label: 'Name', type: 'text', autoComplete: 'name', hint: 'Up to 100 characters' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { name: 'subject', label: 'Subject', type: 'text', autoComplete: 'off', hint: 'Up to 150 characters' },
  { name: 'message', label: 'Message', multiline: true, hint: '10 to 5000 characters' },
];

const controlId = (field) => `contact-${field}`;

/** Keeps only the errors that name one of the four visible fields. */
const pickFieldErrors = (errors) =>
  Object.fromEntries(Object.entries(errors).filter(([field]) => CONTACT_FIELD_ORDER.includes(field)));

const messageOf = (error) =>
  error instanceof ApiError && hasText(error.message) ? error.message : DEFAULT_ERROR_MESSAGE;

/**
 * Contact page (Requirement 29).
 *
 * - Form: labelled name, email, subject and message fields (29.1) plus the `website`
 *   Honeypot_Field, which is off-screen (`.hp-field`), hidden from assistive technology,
 *   out of the tab order, not autofilled, and sent unchanged (29.9).
 * - Submit: the values are trimmed and checked with `validateContact` (29.2). Invalid → an error
 *   next to each invalid field, focus on the first invalid one, values kept, no request (29.3).
 *   Valid → one request through `useAsyncAction`; while it runs the button is disabled,
 *   `aria-busy` and labelled "Sending…", and further submits are ignored (29.4, 29.10).
 * - Outcome: 201 → success message in a polite live region, all values and errors cleared
 *   (29.5). 429 → "try again later" message, values kept, no field errors (29.7, 8.8). Any other
 *   Error_Response or a failed request → form-level alert, values kept, `details` shown next to
 *   their fields (29.6).
 * - Contact details: the Profile email (mailto) and GitHub/LinkedIn links (new tab), each omitted
 *   when empty (29.8). While the Profile loads a loading indicator, and on failure an error with
 *   Retry, take their place; the form stays usable (29.11).
 */
export default function ContactPage() {
  usePublicPageTitle(PAGE_NAMES.contact);
  const { profile, profileState } = useSiteData();
  const { run, pending } = useAsyncAction(submitContact);

  const [values, setValues] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [focusRequest, setFocusRequest] = useState(null);
  const controlRefs = useRef({});

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

    setSuccess(false);
    setFormError(null);

    const result = validateContact(values);
    if (!result.valid) {
      const fieldErrors = pickFieldErrors(result.errors);
      setErrors(fieldErrors);
      const field = firstInvalidField(fieldErrors, CONTACT_FIELD_ORDER);
      if (field) setFocusRequest({ field });
      return;
    }

    setErrors({});
    // The honeypot value goes to the server exactly as entered (29.9, 8.4).
    const outcome = await run({ ...result.values, [HONEYPOT_FIELD]: values[HONEYPOT_FIELD] });

    if (outcome.status === 'success') {
      setValues(EMPTY_VALUES);
      setErrors({});
      setSuccess(true);
    } else if (outcome.status === 'error') {
      const { error } = outcome;
      if (error instanceof ApiError && error.status === 429) {
        setErrors({});
        setFormError(hasText(error.message) ? error.message : CONTACT_RATE_LIMIT_MESSAGE);
      } else {
        setErrors(pickFieldErrors(errorsFromDetails(error?.details)));
        setFormError(messageOf(error));
      }
    }
  };

  return (
    <div className="container contact-page">
      <header className="page-header">
        <h1 className="page-header__title">{PAGE_NAMES.contact}</h1>
      </header>

      <div className="contact-layout">
        <section className="contact-form-section" aria-labelledby="contact-form-title">
          <h2 id="contact-form-title" className="contact-section__title">
            Send a message
          </h2>
          <form className="form contact-form" noValidate onSubmit={handleSubmit}>
            {FIELDS.map((field) => (
              <FormField
                key={field.name}
                id={controlId(field.name)}
                label={field.label}
                hint={field.hint}
                error={errors[field.name]}
                required
              >
                {(controlProps) =>
                  field.multiline ? (
                    <textarea
                      {...controlProps}
                      ref={(el) => {
                        controlRefs.current[field.name] = el;
                      }}
                      className="form-control"
                      name={field.name}
                      rows={8}
                      value={values[field.name]}
                      onChange={update(field.name)}
                    />
                  ) : (
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
                  )
                }
              </FormField>
            ))}

            <div className="hp-field" aria-hidden="true">
              <label htmlFor={HONEYPOT_FIELD}>Website (leave this field empty)</label>
              <input
                id={HONEYPOT_FIELD}
                name={HONEYPOT_FIELD}
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={values[HONEYPOT_FIELD]}
                onChange={update(HONEYPOT_FIELD)}
              />
            </div>

            {/* Always mounted so screen readers announce what is placed inside it (29.5). */}
            <div className="contact-form__status" role="status" aria-live="polite">
              {pending ? <span className="visually-hidden">Sending your message…</span> : null}
              {success ? <p className="form-success">{CONTACT_SUCCESS_MESSAGE}</p> : null}
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
                {pending ? CONTACT_SENDING_LABEL : 'Send message'}
              </button>
            </div>
          </form>
        </section>

        <ContactDetails profile={profile} profileState={profileState} />
      </div>
    </div>
  );
}

/** Profile email, GitHub and LinkedIn, or the loading/error state of the Profile request. */
function ContactDetails({ profile, profileState }) {
  let content;
  if (profileState.error) {
    content = <ErrorState message={profileState.error?.message} onRetry={profileState.retry} />;
  } else if (profileState.loading || !profile) {
    content = <LoadingIndicator label="Loading contact details…" />;
  } else {
    const links = [
      { label: 'GitHub', href: profile.github_url },
      { label: 'LinkedIn', href: profile.linkedin_url },
    ].filter((link) => isValidUrl(link.href));
    const hasEmail = hasText(profile.email);

    if (!hasEmail && links.length === 0) return null;

    content = (
      <ul className="contact-details__list">
        {hasEmail ? (
          <li className="contact-details__item">
            <span className="contact-details__label">Email</span>
            <SafeLink href={profile.email} kind="email" className="contact-details__link">
              {profile.email}
            </SafeLink>
          </li>
        ) : null}
        {links.map((link) => (
          <li key={link.label} className="contact-details__item">
            <SafeLink href={link.href} className="contact-details__link">
              {link.label}
            </SafeLink>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="contact-details" aria-labelledby="contact-details-title">
      <h2 id="contact-details-title" className="contact-section__title">
        Other ways to reach me
      </h2>
      {content}
    </section>
  );
}
