/**
 * Loading indicator shown in place of a page's or section's content while its data request
 * runs (32.7). The label is announced politely through a `role="status"` live region; the
 * spinner is decorative.
 *
 * @param {{ label?: string, className?: string }} props
 */
export function LoadingIndicator({ label = 'Loading…', className }) {
  return (
    <div className={className ? `loading ${className}` : 'loading'} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export default LoadingIndicator;
