import { useEffect, useRef } from 'react';

let keyCounter = 0;
const newKey = () => {
  keyCounter += 1;
  return `item-${keyCounter}`;
};

/**
 * Editable ordered list of short texts, used for project features and experience
 * responsibilities (Requirements 31.8, 31.9, 34.2, 34.4).
 *
 * Each item is a text input with a visible label "`itemLabel` n" ("Feature 1", "Feature 2", ...)
 * and three buttons whose accessible names include the item: "Move up Feature 2",
 * "Move down Feature 2" and "Remove Feature 2". Move up is disabled on the first item and
 * Move down on the last. The Add button (default text "Add feature") appends an empty item
 * and is disabled once `maxItems` items exist. All controls are native inputs and buttons,
 * so the editor works with Tab, Enter and Space alone. Items are passed to `onChange` in the
 * order shown, which is the order the form sends.
 *
 * Focus after each action:
 * - Add → the new item's input;
 * - Remove → the Remove button of the item that took its place, else of the previous item,
 *   else the Add button;
 * - Move → the same button on the moved item, or its other move button when the item reached
 *   the edge and the pressed button became disabled.
 *
 * Errors use the validator keys (`utils/validation.js`): `errors[name]` is shown for the whole
 * list and `errors[\`${name}[i]\`]` next to item i (for example `features[2]`), connected
 * with `aria-describedby` and `aria-invalid="true"`. `name` defaults to `id`.
 *
 * @param {{
 *   id: string,
 *   label: import('react').ReactNode,
 *   items: string[],
 *   onChange: (items: string[]) => void,
 *   name?: string,
 *   maxItems?: number,
 *   itemLabel?: string,
 *   addLabel?: string,
 *   hint?: import('react').ReactNode,
 *   errors?: Record<string, string | undefined> | null,
 *   className?: string,
 * }} props
 */
export function ListEditor({
  id,
  label,
  items,
  onChange,
  name = id,
  maxItems,
  itemLabel = 'Item',
  addLabel,
  hint,
  errors,
  className,
}) {
  const list = Array.isArray(items) ? items : [];
  const errorMap = errors ?? {};

  // Stable keys per item so React moves the DOM nodes (and focus) with the item on reorder.
  const keysRef = useRef([]);
  const keys = list.map((_, i) => keysRef.current[i] ?? newKey());
  keysRef.current = keys;

  const nodesRef = useRef(new Map());
  const pendingFocusRef = useRef(null);

  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    const nodes = nodesRef.current;
    const candidates = target.parts.map((part) => (part === 'add' ? nodes.get('add') : nodes.get(`${target.key}:${part}`)));
    const el = candidates.find((node) => node && !node.disabled);
    el?.focus();
  });

  const setNode = (nodeKey) => (el) => {
    if (el) nodesRef.current.set(nodeKey, el);
    else nodesRef.current.delete(nodeKey);
  };

  const commit = (nextItems, nextKeys, focusTarget) => {
    keysRef.current = nextKeys;
    pendingFocusRef.current = focusTarget;
    onChange(nextItems);
  };

  const atMax = typeof maxItems === 'number' && list.length >= maxItems;

  const add = () => {
    if (atMax) return;
    const key = newKey();
    commit([...list, ''], [...keys, key], { key, parts: ['input'] });
  };

  const remove = (index) => {
    const nextItems = list.filter((_, i) => i !== index);
    const nextKeys = keys.filter((_, i) => i !== index);
    const neighbor = nextKeys[index] ?? nextKeys[index - 1];
    commit(nextItems, nextKeys, neighbor ? { key: neighbor, parts: ['remove'] } : { parts: ['add'] });
  };

  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const nextItems = [...list];
    const nextKeys = [...keys];
    [nextItems[index], nextItems[target]] = [nextItems[target], nextItems[index]];
    [nextKeys[index], nextKeys[target]] = [nextKeys[target], nextKeys[index]];
    const parts = direction < 0 ? ['up', 'down'] : ['down', 'up'];
    commit(nextItems, nextKeys, { key: keys[index], parts });
  };

  const update = (index, value) => {
    onChange(list.map((item, i) => (i === index ? value : item)));
  };

  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const listErrorId = `${id}-error`;
  const listError = errorMap[name];
  const countId = `${id}-count`;
  const describedBy =
    [hint ? hintId : null, typeof maxItems === 'number' ? countId : null, listError ? listErrorId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className={className ? `form-field ${className}` : 'form-field'}>
      <p id={labelId} className="form-field__label">
        {label}
      </p>
      <div className="list-editor" role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
        {hint ? (
          <p id={hintId} className="form-field__hint">
            {hint}
          </p>
        ) : null}
        {listError ? (
          <p id={listErrorId} className="form-field__error">
            {listError}
          </p>
        ) : null}
        {list.length > 0 ? (
          <ol className="list-editor__list">
            {list.map((value, index) => {
              const key = keys[index];
              const itemName = `${itemLabel} ${index + 1}`;
              const inputId = `${id}-${index}`;
              const itemError = errorMap[`${name}[${index}]`];
              const itemErrorId = `${inputId}-error`;
              return (
                <li key={key} className="list-editor__row">
                  <label htmlFor={inputId} className="list-editor__index">
                    {itemName}
                  </label>
                  <div className="list-editor__input">
                    <input
                      ref={setNode(`${key}:input`)}
                      id={inputId}
                      type="text"
                      className="form-control"
                      value={value ?? ''}
                      onChange={(event) => update(index, event.target.value)}
                      aria-invalid={itemError ? 'true' : undefined}
                      aria-describedby={itemError ? itemErrorId : undefined}
                    />
                    {itemError ? (
                      <p id={itemErrorId} className="form-field__error">
                        {itemError}
                      </p>
                    ) : null}
                  </div>
                  <div className="list-editor__controls">
                    <button
                      ref={setNode(`${key}:up`)}
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move up ${itemName}`}
                    >
                      Move up
                    </button>
                    <button
                      ref={setNode(`${key}:down`)}
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => move(index, 1)}
                      disabled={index === list.length - 1}
                      aria-label={`Move down ${itemName}`}
                    >
                      Move down
                    </button>
                    <button
                      ref={setNode(`${key}:remove`)}
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => remove(index)}
                      aria-label={`Remove ${itemName}`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
        {typeof maxItems === 'number' ? (
          <p id={countId} className="form-field__hint">
            {`${list.length} of ${maxItems} used`}
          </p>
        ) : null}
        <button
          ref={setNode('add')}
          type="button"
          className="btn btn--secondary list-editor__add"
          onClick={add}
          disabled={atMax}
        >
          {addLabel ?? `Add ${itemLabel.toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}

export default ListEditor;
