import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/apiClient.js';
import * as settingsApi from '../../api/settingsApi.js';
import { ErrorState, FormField, LoadingIndicator } from '../../components/common/index.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { SOCIAL_LINKS_MAX, errorsFromDetails, validateSettings } from '../../utils/validation.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import '../../styles/pages/admin-settings.css';

export const SETTINGS_HEADING = 'Settings';
export const SETTINGS_LOAD_ERROR_TITLE = 'The settings could not be loaded.';
export const SETTINGS_SAVED_MESSAGE = 'Settings saved.';
export const SETTINGS_SAVE_FAILED_MESSAGE = 'The settings could not be saved. Please try again.';
export const SETTINGS_INVALID_MESSAGE = 'The settings were not saved. Check the highlighted fields.';
export const SETTINGS_NO_CHANGES_MESSAGE = 'There are no changes to save.';
export const SETTINGS_SAVING_LABEL = 'Saving…';

/** Text fields in display order; `social_links` follows them. */
export const SETTINGS_TEXT_FIELDS = Object.freeze(['site_title', 'hero_introduction', 'footer_text']);

/** `social_links` (whole list), `social_links[2]` (one entry) or `social_links[2].label|url`. */
const SOCIAL_KEY = /^social_links(?:\[(\d+)\](?:\.(label|url))?)?$/;

const isFieldKey = (key) => SETTINGS_TEXT_FIELDS.includes(key) || SOCIAL_KEY.test(key);

const controlId = (field) => `settings-${field.replaceAll('_', '-')}`;
const linkId = (index) => `settings-social-links-${index}`;
const ADD_LINK_ID = 'settings-social-links-add';

const text = (value) => (typeof value === 'string' ? value : '');

let keyCounter = 0;
const newKey = () => {
  keyCounter += 1;
  return `link-${keyCounter}`;
};

/**
 * Form values for a Settings object. Each Social_Link row gets a stable `key` so React keeps
 * the row's DOM (and focus) with it when rows move; `keys` reuses existing keys by index.
 */
export function toFormValues(settings, keys = []) {
  const links = Array.isArray(settings?.social_links) ? settings.social_links : [];
  return {
    site_title: text(settings?.site_title),
    hero_introduction: text(settings?.hero_introduction),
    footer_text: text(settings?.footer_text),
    social_links: links.map((link, i) => ({ key: keys[i] ?? newKey(), label: text(link?.label), url: text(link?.url) })),
  };
}

const sameLinks = (a, b) =>
  a.length === b.length &&
  a.every((link, i) => link.label.trim() === b[i].label.trim() && link.url.trim() === b[i].url.trim());

/**
 * The keys whose values differ from the saved Settings, ignoring leading and trailing
 * whitespace (the API_Server trims them, 11.2). Returns the entered values, links without
 * their row keys, ready for `validateSettings`.
 */
export function changedSettings(values, saved) {
  const changes = {};
  for (const field of SETTINGS_TEXT_FIELDS) {
    if (values[field].trim() !== saved[field].trim()) changes[field] = values[field];
  }
  if (!sameLinks(values.social_links, saved.social_links)) {
    changes.social_links = values.social_links.map(({ label, url }) => ({ label, url }));
  }
  return changes;
}

/** Id of the control to focus for the first error in display order, or null. */
function firstErrorControlId(errors) {
  for (const field of SETTINGS_TEXT_FIELDS) {
    if (Object.hasOwn(errors, field)) return controlId(field);
  }
  if (Object.hasOwn(errors, 'social_links')) return ADD_LINK_ID;
  const items = Object.keys(errors)
    .map((key) => SOCIAL_KEY.exec(key))
    .filter((match) => match && match[1] !== undefined)
    .map((match) => ({ index: Number(match[1]), part: match[2] ?? 'label' }))
    .sort((a, b) => a.index - b.index || (a.part === b.part ? 0 : a.part === 'label' ? -1 : 1));
  return items.length > 0 ? `${linkId(items[0].index)}-${items[0].part}` : null;
}

const splitErrors = (errors) => {
  const fieldErrors = {};
  const other = [];
  for (const [key, message] of Object.entries(errors)) {
    if (isFieldKey(key)) fieldErrors[key] = message;
    else other.push(message);
  }
  return { fieldErrors, other };
};

const errorMessageOr = (error, fallback) =>
  error instanceof ApiError && typeof error.message === 'string' && error.message.trim() !== ''
    ? error.message
    : fallback;

/**
 * Website Settings form at `/admin/settings` (Requirements 11.4, 11.9, 31.13, 31.15, 31.16).
 *
 * Loads `GET /api/settings` first; the form, and with it the submit button, appears only once
 * the current values are known. A failed load shows an error with Retry.
 *
 * The public layout reads Settings through the SiteDataProvider, which mounts with the public
 * route tree, so the Public_Site fetches the saved values the next time it is opened (11.6).
 */
export default function SettingsFormPage() {
  usePageTitle(SETTINGS_HEADING, ADMIN_TITLE_SUFFIX);
  const { loading, data, error, retry } = useFetch((signal) => settingsApi.get({ signal }), []);

  let content;
  if (loading) {
    content = <LoadingIndicator label="Loading settings…" />;
  } else if (error) {
    content = <ErrorState title={SETTINGS_LOAD_ERROR_TITLE} message={error?.message} onRetry={retry} />;
  } else {
    content = <SettingsForm initialSettings={data} />;
  }

  return (
    <>
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">{SETTINGS_HEADING}</h1>
      </div>
      {content}
    </>
  );
}

/**
 * - Submit compares the form with the last saved Settings and sends only the changed keys to
 *   `PUT /api/settings` (11.9). With no changes it sends nothing and says so.
 * - The changed keys are checked with `validateSettings` first (11.4): site title 1–100, hero
 *   introduction 0–500, footer text 0–300, up to 10 links each with a 1–50 character label and
 *   an http or https URL. Failures show next to the fields, focus the first one and send nothing.
 * - One request at a time; the submit button is disabled and labelled "Saving…" (31.13).
 * - Success: success Notification; the returned Settings become the saved state. The entered
 *   values stay in the form.
 * - Any failure except 401: error Notification, entered values kept; a 400 with `details` also
 *   shows each error next to its field (11.9, 31.15, 31.16). A 401 is left to the Auth_Context.
 */
function SettingsForm({ initialSettings }) {
  const { notify } = useNotify();
  const { run, pending } = useAsyncAction((payload) => settingsApi.update(payload));

  const [values, setValues] = useState(() => toFormValues(initialSettings));
  const [saved, setSaved] = useState(values);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);

  // Focus after the render that adds aria-invalid and the error text, so both are announced.
  useEffect(() => {
    if (focusRequest) document.getElementById(focusRequest.id)?.focus();
  }, [focusRequest]);

  const update = (field) => (event) => {
    const { value } = event.target;
    setNotice(null);
    setValues((current) => ({ ...current, [field]: value }));
  };

  const updateLinks = (links) => {
    setNotice(null);
    setValues((current) => ({ ...current, social_links: links }));
  };

  const showErrors = (fieldErrors, other) => {
    setErrors(fieldErrors);
    setFormError(other.length > 0 ? other.join(' ') : null);
    const id = firstErrorControlId(fieldErrors);
    if (id) setFocusRequest({ id });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    setNotice(null);

    const changes = changedSettings(values, saved);
    if (Object.keys(changes).length === 0) {
      setErrors({});
      setNotice(SETTINGS_NO_CHANGES_MESSAGE);
      return;
    }

    const result = validateSettings(changes);
    if (!result.valid) {
      const { fieldErrors, other } = splitErrors(result.errors);
      showErrors(fieldErrors, other);
      return;
    }

    setErrors({});
    const outcome = await run(result.values);
    if (outcome.status === 'success') {
      const settings =
        outcome.data && typeof outcome.data === 'object' ? outcome.data : { ...saved, ...result.values };
      setSaved(toFormValues(settings, values.social_links.map((link) => link.key)));
      notify({ type: 'success', message: SETTINGS_SAVED_MESSAGE });
      return;
    }
    if (outcome.status !== 'error') return;

    const { error } = outcome;
    const status = error instanceof ApiError ? error.status : undefined;
    if (status === 401) return; // session expiry is handled by the Auth_Context

    if (status === 400) {
      const { fieldErrors, other } = splitErrors(errorsFromDetails(error.details));
      if (Object.keys(fieldErrors).length > 0 || other.length > 0) {
        showErrors(fieldErrors, other);
        notify({ type: 'error', message: SETTINGS_INVALID_MESSAGE });
        return;
      }
    }
    notify({ type: 'error', message: errorMessageOr(error, SETTINGS_SAVE_FAILED_MESSAGE) });
  };

  return (
    <form className="form admin-form admin-panel admin-settings-form" noValidate onSubmit={handleSubmit}>
      <div className="form-grid">
        <div className="form-grid__full">
          <FormField
            id={controlId('site_title')}
            label="Site title"
            required
            hint="Shown as the browser tab title. Up to 100 characters"
            error={errors.site_title}
          >
            {(controlProps) => (
              <input
                {...controlProps}
                className="form-control"
                type="text"
                name="site_title"
                value={values.site_title}
                onChange={update('site_title')}
              />
            )}
          </FormField>
        </div>
        <div className="form-grid__full">
          <FormField
            id={controlId('hero_introduction')}
            label="Hero introduction"
            hint="Shown on the Home page. Optional, up to 500 characters"
            error={errors.hero_introduction}
          >
            {(controlProps) => (
              <textarea
                {...controlProps}
                className="form-control"
                name="hero_introduction"
                rows={4}
                value={values.hero_introduction}
                onChange={update('hero_introduction')}
              />
            )}
          </FormField>
        </div>
        <div className="form-grid__full">
          <FormField
            id={controlId('footer_text')}
            label="Footer text"
            hint="Shown in the site footer. Optional, up to 300 characters"
            error={errors.footer_text}
          >
            {(controlProps) => (
              <textarea
                {...controlProps}
                className="form-control"
                name="footer_text"
                rows={3}
                value={values.footer_text}
                onChange={update('footer_text')}
              />
            )}
          </FormField>
        </div>
        <div className="form-grid__full">
          <SocialLinksEditor links={values.social_links} onChange={updateLinks} errors={errors} />
        </div>
      </div>

      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}
      {notice ? (
        <p className="admin-settings-form__notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={pending}
          aria-busy={pending ? 'true' : undefined}
        >
          {pending ? SETTINGS_SAVING_LABEL : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

/**
 * Ordered editor for the footer Social_Links: one row per link with a Label and a URL input
 * and Move up, Move down and Remove buttons named after the row ("Remove Link 2"). Add appends
 * an empty row and is disabled at 10 links. Native inputs and buttons only, so it works with
 * the keyboard alone; links are sent in the order shown.
 *
 * Focus after each action: Add → the new row's Label input; Remove → the Remove button of the
 * row that took its place, else of the previous row, else Add; Move → the same button on the
 * moved row, or its other move button when the pressed one became disabled.
 *
 * Errors use the validator keys: `social_links` for the list, `social_links[i]` for a row and
 * `social_links[i].label` / `social_links[i].url` for its inputs.
 */
function SocialLinksEditor({ links, onChange, errors }) {
  const pendingFocusRef = useRef(null);

  useEffect(() => {
    const ids = pendingFocusRef.current;
    if (!ids) return;
    pendingFocusRef.current = null;
    const el = ids.map((id) => document.getElementById(id)).find((node) => node && !node.disabled);
    el?.focus();
  });

  const commit = (next, focusIds) => {
    pendingFocusRef.current = focusIds;
    onChange(next);
  };

  const atMax = links.length >= SOCIAL_LINKS_MAX;

  const add = () => {
    if (atMax) return;
    commit([...links, { key: newKey(), label: '', url: '' }], [`${linkId(links.length)}-label`]);
  };

  const remove = (index) => {
    const next = links.filter((_, i) => i !== index);
    const focusIds = [];
    if (index < next.length) focusIds.push(`${linkId(index)}-remove`);
    if (index > 0) focusIds.push(`${linkId(index - 1)}-remove`);
    focusIds.push(ADD_LINK_ID);
    commit(next, focusIds);
  };

  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= links.length) return;
    const next = [...links];
    [next[index], next[target]] = [next[target], next[index]];
    const parts = direction < 0 ? ['up', 'down'] : ['down', 'up'];
    commit(next, parts.map((part) => `${linkId(target)}-${part}`));
  };

  const change = (index, part) => (event) => {
    const { value } = event.target;
    onChange(links.map((link, i) => (i === index ? { ...link, [part]: value } : link)));
  };

  const labelId = 'settings-social-links-label';
  const hintId = 'settings-social-links-hint';
  const countId = 'settings-social-links-count';
  const listErrorId = 'settings-social-links-error';
  const listError = errors.social_links;
  const describedBy = [hintId, countId, listError ? listErrorId : null].filter(Boolean).join(' ');

  return (
    <div className="form-field admin-settings-links">
      <p id={labelId} className="form-field__label">
        Social links
      </p>
      <div className="admin-settings-links__group" role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
        <p id={hintId} className="form-field__hint">
          Shown as footer links in this order. Each link needs a label of up to 50 characters and an http or
          https URL.
        </p>
        {listError ? (
          <p id={listErrorId} className="form-field__error">
            {listError}
          </p>
        ) : null}
        {links.length > 0 ? (
          <ol className="admin-settings-links__list">
            {links.map((link, index) => {
              const id = linkId(index);
              const name = `Link ${index + 1}`;
              const rowError = errors[`social_links[${index}]`];
              const inputLabel = (part) => (
                <>
                  <span className="visually-hidden">{`${name} `}</span>
                  {part}
                </>
              );
              return (
                <li key={link.key} className="admin-settings-links__row">
                  <p className="admin-settings-links__name">{name}</p>
                  <div className="admin-settings-links__fields">
                    <FormField
                      id={`${id}-label`}
                      label={inputLabel('Label')}
                      required
                      error={errors[`social_links[${index}].label`]}
                      className="admin-settings-links__label"
                    >
                      {(controlProps) => (
                        <input
                          {...controlProps}
                          className="form-control"
                          type="text"
                          value={link.label}
                          onChange={change(index, 'label')}
                        />
                      )}
                    </FormField>
                    <FormField
                      id={`${id}-url`}
                      label={inputLabel('URL')}
                      required
                      error={errors[`social_links[${index}].url`]}
                      className="admin-settings-links__url"
                    >
                      {(controlProps) => (
                        <input
                          {...controlProps}
                          className="form-control"
                          type="url"
                          inputMode="url"
                          autoComplete="off"
                          value={link.url}
                          onChange={change(index, 'url')}
                        />
                      )}
                    </FormField>
                  </div>
                  {rowError ? <p className="form-field__error admin-settings-links__row-error">{rowError}</p> : null}
                  <div className="admin-settings-links__controls">
                    <button
                      id={`${id}-up`}
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move up ${name}`}
                    >
                      Move up
                    </button>
                    <button
                      id={`${id}-down`}
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => move(index, 1)}
                      disabled={index === links.length - 1}
                      aria-label={`Move down ${name}`}
                    >
                      Move down
                    </button>
                    <button
                      id={`${id}-remove`}
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => remove(index)}
                      aria-label={`Remove ${name}`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
        <p id={countId} className="form-field__hint">
          {`${links.length} of ${SOCIAL_LINKS_MAX} used`}
        </p>
        <button
          id={ADD_LINK_ID}
          type="button"
          className="btn btn--secondary admin-settings-links__add"
          onClick={add}
          disabled={atMax}
        >
          Add social link
        </button>
      </div>
    </div>
  );
}
