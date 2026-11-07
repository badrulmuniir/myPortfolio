/**
 * Renders Database-sourced text as escaped plain text, keeping its stored line breaks through
 * `white-space: pre-line` (`.pre-line`, 23.4, 28.5). HTML markup in the value shows as literal
 * characters because React escapes text children; no raw HTML injection is used (9.7).
 *
 * Renders nothing when `text` is not a string or is empty or whitespace-only, so callers can
 * omit an empty section by checking the same condition with `hasText`.
 *
 * @param {{ text?: unknown, as?: import('react').ElementType, className?: string }} props
 */
export function MultilineText({ text, as: Tag = 'p', className, ...rest }) {
  if (!hasText(text)) return null;
  return (
    <Tag {...rest} className={className ? `pre-line ${className}` : 'pre-line'}>
      {text}
    </Tag>
  );
}

/** True when `value` is a string with at least one non-whitespace character. */
export function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export default MultilineText;
