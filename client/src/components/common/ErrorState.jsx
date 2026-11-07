/** Shown when no message is given, for example for an error that is not an ApiError. */
export const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Error state shown in place of a page's or section's content when its data request fails
 * (32.8). Shows `message` (normally `ApiError.message`, which is the Error_Response message or
 * the API_Client's generic network message) and a Retry button that calls `onRetry` (32.9).
 * The Retry button is omitted when `onRetry` is not a function. `children` adds extra actions
 * next to Retry, such as a link back to the Projects page (26.5).
 *
 * The title is a paragraph, not a heading, so the component never breaks heading levels (34.6).
 *
 * @param {{ message?: string, onRetry?: () => void, title?: string, retryLabel?: string,
 *           className?: string, children?: import('react').ReactNode }} props
 */
export function ErrorState({ message, onRetry, title, retryLabel = 'Retry', className, children }) {
  const text = typeof message === 'string' && message.trim() !== '' ? message : DEFAULT_ERROR_MESSAGE;
  const hasRetry = typeof onRetry === 'function';
  return (
    <div className={className ? `state state--error ${className}` : 'state state--error'} role="alert">
      {title ? <p className="state__title">{title}</p> : null}
      <p className="state__message">{text}</p>
      {hasRetry || children ? (
        <div className="state__actions">
          {hasRetry ? (
            <button type="button" className="btn btn--primary" onClick={() => onRetry()}>
              {retryLabel}
            </button>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}

export default ErrorState;
