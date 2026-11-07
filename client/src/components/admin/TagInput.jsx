import { useEffect, useMemo, useRef, useState } from 'react';
import { PROJECT_TECHNOLOGIES_MAX, TECHNOLOGY_NAME_MAX, addTag, tagError } from '../../utils/validation.js';

/** Most suggestions shown at once. */
export const MAX_SUGGESTIONS = 10;

/**
 * Suggestions for the typed text: names that contain the trimmed text case-insensitively,
 * excluding names already in `tags` (case-insensitive) and case-insensitive repeats, in the
 * order given, at most `limit`. Blank text gives no suggestions.
 *
 * @param {string[]} suggestions
 * @param {string[]} tags
 * @param {string} text
 * @param {number} [limit]
 * @returns {string[]}
 */
export function filterSuggestions(suggestions, tags, text, limit = MAX_SUGGESTIONS) {
  const typed = typeof text === 'string' ? text.trim().toLowerCase() : '';
  if (typed === '' || !Array.isArray(suggestions)) return [];
  const seen = new Set((tags ?? []).map((tag) => String(tag).trim().toLowerCase()));
  const out = [];
  for (const suggestion of suggestions) {
    if (typeof suggestion !== 'string') continue;
    const key = suggestion.trim().toLowerCase();
    if (key === '' || seen.has(key) || !key.includes(typed)) continue;
    seen.add(key);
    out.push(suggestion.trim());
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Technology name editor for the project form (Requirement 31.8, 34.2, 34.4).
 *
 * Shows the added names as chips, each with a Remove button named "Remove <name>", and a
 * labelled text input with an Add button. Enter in the input (or the Add button) adds the
 * typed name through `addTag`/`tagError`: an empty or whitespace-only name, a name longer than
 * `maxLength`, a case-insensitive duplicate of an added name, or a name beyond `max` is not
 * added, and the reason is shown under the input (and announced) until the text changes.
 * Enter never submits the surrounding form.
 *
 * The input is an ARIA combobox. While the trimmed text is not blank, a `role="listbox"` shows
 * up to MAX_SUGGESTIONS names from `suggestions` that contain the text (case-insensitive),
 * excluding names already added. ArrowDown/ArrowUp move the highlighted option
 * (`aria-activedescendant`, wrapping at the ends), Enter adds the highlighted option (or the
 * typed text when none is highlighted), Escape closes the list, and clicking an option adds it.
 * Focus stays in the input.
 *
 * `error` (from the form validator or the server `details`, for example `technologies` or
 * `technologies[2]`) is shown when there is no local message.
 *
 * @param {{
 *   id: string,
 *   label: import('react').ReactNode,
 *   tags: string[],
 *   onChange: (tags: string[]) => void,
 *   suggestions?: string[],
 *   max?: number,
 *   maxLength?: number,
 *   error?: string | null,
 *   hint?: import('react').ReactNode,
 *   addLabel?: string,
 *   className?: string,
 * }} props
 */
export function TagInput({
  id,
  label,
  tags,
  onChange,
  suggestions = [],
  max = PROJECT_TECHNOLOGIES_MAX,
  maxLength = TECHNOLOGY_NAME_MAX,
  error,
  hint,
  addLabel = 'Add',
  className,
}) {
  const list = useMemo(() => (Array.isArray(tags) ? tags : []), [tags]);
  const [text, setText] = useState('');
  const [message, setMessage] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef(null);
  const removeRefs = useRef([]);
  const pendingFocusRef = useRef(null);

  const options = useMemo(() => filterSuggestions(suggestions, list, text), [suggestions, list, text]);
  const expanded = open && options.length > 0;
  const activeIndex = expanded && active < options.length ? active : -1;

  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    const el = target === 'input' ? inputRef.current : removeRefs.current[target];
    (el ?? inputRef.current)?.focus();
  });

  const closeList = () => {
    setOpen(false);
    setActive(-1);
  };

  const add = (name) => {
    const options_ = { max, maxLength };
    const reason = tagError(list, name, options_);
    if (reason !== null) {
      setMessage(reason);
      closeList();
      return false;
    }
    onChange(addTag(list, name, options_));
    setText('');
    setMessage(null);
    closeList();
    return true;
  };

  const remove = (index) => {
    const next = list.filter((_, i) => i !== index);
    pendingFocusRef.current = next.length === 0 ? 'input' : Math.min(index, next.length - 1);
    setMessage(null);
    onChange(next);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) return;
      event.preventDefault();
      const down = event.key === 'ArrowDown';
      if (!expanded) {
        setOpen(true);
        setActive(down ? 0 : options.length - 1);
        return;
      }
      const n = options.length;
      if (down) setActive(activeIndex < 0 ? 0 : (activeIndex + 1) % n);
      else setActive(activeIndex <= 0 ? n - 1 : activeIndex - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      add(activeIndex >= 0 ? options[activeIndex] : text);
    } else if (event.key === 'Escape' || event.key === 'Esc') {
      if (expanded) {
        event.preventDefault();
        event.stopPropagation();
        closeList();
      }
    }
  };

  const labelId = `${id}-label`;
  const listboxId = `${id}-listbox`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const optionId = (index) => `${id}-option-${index}`;
  const shownError = message ?? (error || null);
  const describedBy = [hint ? hintId : null, shownError ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className ? `form-field ${className}` : 'form-field'}>
      <label id={labelId} htmlFor={id} className="form-field__label">
        {label}
      </label>
      <div className="tag-input">
        {list.length > 0 ? (
          <ul className="tag-input__chips">
            {list.map((tag, index) => (
              <li key={`${tag}-${index}`} className="tag-input__chip">
                <span>{tag}</span>
                <button
                  ref={(el) => {
                    removeRefs.current[index] = el;
                  }}
                  type="button"
                  className="tag-input__remove"
                  onClick={() => remove(index)}
                >
                  <span aria-hidden="true">×</span>
                  <span className="visually-hidden">{`Remove ${tag}`}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="tag-input__field">
          <input
            ref={inputRef}
            id={id}
            type="text"
            className="form-control"
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={expanded ? 'true' : 'false'}
            aria-controls={expanded ? listboxId : undefined}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-describedby={describedBy}
            aria-invalid={shownError ? 'true' : undefined}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setMessage(null);
              setOpen(true);
              setActive(-1);
            }}
            onKeyDown={onKeyDown}
            onBlur={closeList}
          />
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              add(text);
              inputRef.current?.focus();
            }}
          >
            {addLabel}
          </button>
        </div>
        {expanded ? (
          <ul id={listboxId} role="listbox" aria-labelledby={labelId} className="tag-input__suggestions">
            {options.map((option, index) => (
              <li
                key={option}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex ? 'true' : 'false'}
                className="tag-input__suggestion"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add(option)}
              >
                {option}
              </li>
            ))}
          </ul>
        ) : null}
        {hint ? (
          <p id={hintId} className="form-field__hint">
            {hint}
          </p>
        ) : null}
        {shownError ? (
          <p id={errorId} className="form-field__error" role={message ? 'alert' : undefined}>
            {shownError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default TagInput;
