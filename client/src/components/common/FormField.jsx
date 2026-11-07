/**
 * A labelled form field (34.4).
 *
 * API: `children` is a render function that receives the props to spread onto the control.
 * Use it for `<input>`, `<textarea>` and `<select>` alike:
 *
 *   <FormField id="contact-name" label="Name" required error={errors.name} hint="Up to 100 characters">
 *     {(controlProps) => (
 *       <input {...controlProps} className="form-control" type="text" value={name} onChange={...} />
 *     )}
 *   </FormField>
 *
 * `controlProps` = { id, 'aria-describedby', 'aria-invalid', 'aria-required' }:
 *   - `id` ties the visible `<label htmlFor>` to the control. The label is always rendered
 *     and stays visible whatever the control contains.
 *   - `aria-describedby` lists the hint id (`<id>-hint`) and, while `error` is set, the error id
 *     (`<id>-error`). It is undefined when there is neither.
 *   - `aria-invalid` is `"true"` only while `error` is set.
 *   - `aria-required` is `"true"` when `required`. The native `required` attribute is not set,
 *     so the browser's own validation bubbles do not replace the form's error messages.
 * A visible "(required)" marker follows the label text when `required` is true.
 *
 * @param {{ id: string, label: import('react').ReactNode, error?: string | null, hint?: import('react').ReactNode,
 *           required?: boolean, className?: string,
 *           children: (controlProps: Record<string, string | undefined>) => import('react').ReactNode }} props
 */
export function FormField({ id, label, error, hint, required = false, className, children }) {
  if (typeof children !== 'function') {
    throw new TypeError('FormField expects a render function as its child: (controlProps) => <control />');
  }

  const hasError = typeof error === 'string' ? error !== '' : Boolean(error);
  const hasHint = hint !== undefined && hint !== null && hint !== '';
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hasHint ? hintId : null, hasError ? errorId : null].filter(Boolean).join(' ');

  const controlProps = {
    id,
    'aria-describedby': describedBy === '' ? undefined : describedBy,
    'aria-invalid': hasError ? 'true' : undefined,
    'aria-required': required ? 'true' : undefined,
  };

  return (
    <div className={className ? `form-field ${className}` : 'form-field'}>
      <label htmlFor={id} className="form-field__label">
        {label}
        {required ? <span className="form-field__required">(required)</span> : null}
      </label>
      {children(controlProps)}
      {hasHint ? (
        <p id={hintId} className="form-field__hint">
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} className="form-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default FormField;
