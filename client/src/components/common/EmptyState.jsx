/**
 * Empty state shown when a request succeeds with no records (for example 24.4, 25.8, 28.6).
 * `children` adds optional actions below the message. The title is a paragraph, not a heading,
 * so the component never breaks heading levels (34.6).
 *
 * @param {{ message: string, title?: string, className?: string,
 *           children?: import('react').ReactNode }} props
 */
export function EmptyState({ message, title, className, children }) {
  return (
    <div className={className ? `state state--empty ${className}` : 'state state--empty'}>
      {title ? <p className="state__title">{title}</p> : null}
      {message ? <p className="state__message">{message}</p> : null}
      {children ? <div className="state__actions">{children}</div> : null}
    </div>
  );
}

export default EmptyState;
