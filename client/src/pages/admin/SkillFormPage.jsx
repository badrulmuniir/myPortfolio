import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as skillsApi from '../../api/skillsApi.js';
import { EmptyState, ErrorState, FormField, LoadingIndicator } from '../../components/common/index.js';
import { useNotify } from '../../context/NotificationContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useFetch } from '../../hooks/useFetch.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import {
  DISPLAY_ORDER_MAX,
  DISPLAY_ORDER_MIN,
  FORM_ERROR_KEY,
  PROFICIENCY_LEVELS,
  errorsFromDetails,
  firstInvalidField,
  validateSkill,
} from '../../utils/validation.js';
import { ADMIN_TITLE_SUFFIX } from './AdminPagePlaceholder.jsx';
import { SKILLS_PATH, categorySuggestions, failureMessage, isUnauthorized } from './skillPages.js';
import '../../styles/pages/admin-skills.css';

export const NEW_SKILL_HEADING = 'New skill';
export const EDIT_SKILL_HEADING = 'Edit skill';

/** Form fields in display order, used to focus the first invalid field. */
export const SKILL_FIELD_ORDER = Object.freeze(['name', 'category', 'proficiency_level', 'icon_url', 'display_order']);

const FIELD_IDS = Object.freeze({
  name: 'skill-name',
  category: 'skill-category',
  proficiency_level: 'skill-proficiency',
  icon_url: 'skill-icon-url',
  display_order: 'skill-display-order',
});

const CATEGORY_LIST_ID = 'skill-category-suggestions';

const EMPTY_VALUES = Object.freeze({
  name: '',
  category: '',
  proficiency_level: '',
  icon_url: '',
  display_order: '0',
});

/** Form values for a stored Skill; the number input works with a string. */
const valuesFromSkill = (skill) => ({
  name: skill.name ?? '',
  category: skill.category ?? '',
  proficiency_level: skill.proficiency_level ?? '',
  icon_url: skill.icon_url ?? '',
  display_order: String(skill.display_order ?? 0),
});

/**
 * Create and edit form for a Skill at `/admin/skills/new` and `/admin/skills/:id/edit`
 * (Requirements 15.4, 31.3, 31.7, 31.11, 31.13, 31.15, 31.16).
 *
 * The page loads `GET /api/skills` (there is no single-skill endpoint): the edit page finds
 * the Skill there and shows a not-found state for an unknown id, and both pages use the list
 * for the category suggestions (the five defaults plus every category already in use).
 */
export default function SkillFormPage() {
  const { id } = useParams();
  const isEdit = id !== undefined;
  const heading = isEdit ? EDIT_SKILL_HEADING : NEW_SKILL_HEADING;
  usePageTitle(heading, ADMIN_TITLE_SUFFIX);

  const { loading, data, error, retry } = useFetch((signal) => skillsApi.list({ signal }), []);
  const skills = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const suggestions = useMemo(() => categorySuggestions(skills), [skills]);

  let content;
  if (!isEdit) {
    // The suggestions fill in once the list has loaded; the form never waits for it.
    content = <SkillForm initialValues={EMPTY_VALUES} suggestions={suggestions} />;
  } else if (loading || isUnauthorized(error)) {
    content = <LoadingIndicator label="Loading skill…" />;
  } else if (error) {
    content = <ErrorState title="The skill could not be loaded." message={error.message} onRetry={retry} />;
  } else {
    const skill = skills.find((item) => String(item.id) === id);
    content = skill ? (
      <SkillForm key={skill.id} skill={skill} initialValues={valuesFromSkill(skill)} suggestions={suggestions} />
    ) : (
      <EmptyState title="Skill not found" message="No skill with this id exists. It may have been deleted.">
        <Link to={SKILLS_PATH} className="btn btn--secondary">
          Back to skills
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

/**
 * @param {{ skill?: { id: number, name: string }, initialValues: Record<string, string>,
 *           suggestions: string[] }} props
 */
function SkillForm({ skill, initialValues, suggestions }) {
  const isEdit = skill !== undefined;
  const navigate = useNavigate();
  const { notify } = useNotify();
  const formRef = useRef(null);
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});

  const save = useAsyncAction((input) => (isEdit ? skillsApi.update(skill.id, input) : skillsApi.create(input)));

  const setField = (field) => (event) => {
    const { value } = event.target;
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const focusFirstError = (fieldErrors) => {
    const field = firstInvalidField(fieldErrors, SKILL_FIELD_ORDER);
    if (field) formRef.current?.querySelector(`#${FIELD_IDS[field]}`)?.focus();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (save.pending) return;

    // 31.7: no request while any field fails.
    const result = validateSkill(values);
    if (!result.valid) {
      setErrors(result.errors);
      focusFirstError(result.errors);
      return;
    }
    setErrors({});

    const outcome = await save.run(result.values);
    if (outcome.status === 'ignored') return;
    if (outcome.status === 'success') {
      const name = outcome.data?.name ?? result.values.name;
      notify({ type: 'success', message: isEdit ? `Updated skill ${name}.` : `Created skill ${name}.` });
      navigate(SKILLS_PATH); // the list page reloads from the server (31.11)
      return;
    }

    const failure = outcome.error;
    if (isUnauthorized(failure)) return; // the session-expiry handler takes over (6.4)
    // 31.15: server field errors next to the fields; the entered values stay in the form.
    if (failure?.status === 400) {
      const serverErrors = errorsFromDetails(failure.details);
      if (Object.keys(serverErrors).length > 0) {
        setErrors(serverErrors);
        focusFirstError(serverErrors);
      }
    }
    notify({
      type: 'error',
      message: `${isEdit ? 'Could not update the skill' : 'Could not create the skill'}: ${failureMessage(failure)}`,
    });
  };

  // Errors for fields this form does not show (for example a whole-body error).
  const otherErrors = Object.entries(errors).filter(([field]) => !SKILL_FIELD_ORDER.includes(field));

  return (
    <form ref={formRef} className="admin-panel admin-form admin-skills-form" noValidate onSubmit={handleSubmit}>
      {otherErrors.length > 0 ? (
        <ul className="admin-skills-form__errors form-field__error">
          {otherErrors.map(([field, message]) => (
            <li key={field}>{field === FORM_ERROR_KEY ? message : `${field}: ${message}`}</li>
          ))}
        </ul>
      ) : null}

      <div className="form-grid">
        <FormField id={FIELD_IDS.name} label="Name" required error={errors.name} hint="Up to 50 characters.">
          {(controlProps) => (
            <input
              {...controlProps}
              className="form-control"
              type="text"
              autoComplete="off"
              value={values.name}
              onChange={setField('name')}
            />
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.category}
          label="Category"
          required
          error={errors.category}
          hint="Pick a suggestion or type a new category (up to 50 characters). Skills with exactly the same category are grouped together."
        >
          {(controlProps) => (
            <>
              <input
                {...controlProps}
                className="form-control"
                type="text"
                autoComplete="off"
                list={CATEGORY_LIST_ID}
                value={values.category}
                onChange={setField('category')}
              />
              <datalist id={CATEGORY_LIST_ID}>
                {suggestions.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </>
          )}
        </FormField>

        <FormField id={FIELD_IDS.proficiency_level} label="Proficiency level" error={errors.proficiency_level}>
          {(controlProps) => (
            <select
              {...controlProps}
              className="form-control"
              value={values.proficiency_level}
              onChange={setField('proficiency_level')}
            >
              <option value="">Not set</option>
              {PROFICIENCY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.display_order}
          label="Display order"
          required
          error={errors.display_order}
          hint={`Whole number from ${DISPLAY_ORDER_MIN} to ${DISPLAY_ORDER_MAX}. Lower numbers come first within the category.`}
        >
          {(controlProps) => (
            <input
              {...controlProps}
              className="form-control"
              type="number"
              inputMode="numeric"
              min={DISPLAY_ORDER_MIN}
              max={DISPLAY_ORDER_MAX}
              step="1"
              value={values.display_order}
              onChange={setField('display_order')}
            />
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.icon_url}
          label="Icon URL"
          className="form-grid__full"
          error={errors.icon_url}
          hint="Optional. A full http or https address."
        >
          {(controlProps) => (
            <input
              {...controlProps}
              className="form-control"
              type="url"
              inputMode="url"
              autoComplete="off"
              value={values.icon_url}
              onChange={setField('icon_url')}
            />
          )}
        </FormField>
      </div>

      <div className="admin-skills-form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={save.pending}
          aria-busy={save.pending ? 'true' : undefined}
        >
          {save.pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create skill'}
        </button>
        <Link to={SKILLS_PATH} className="btn btn--secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
