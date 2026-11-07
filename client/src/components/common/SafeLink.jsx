import { isValidUrl } from '../../utils/url.js';
import { isValidEmail } from '../../utils/validation.js';

/**
 * Link for a Database-sourced URL (9.7).
 *
 * - `kind="url"` (default): renders `<a href>` only when `href` is a Valid_URL (http or https
 *   with a host). `javascript:`, `data:`, `ftp:`, relative and empty values never become links.
 * - `kind="email"`: renders `<a href="mailto:<href>">` only when `href` is a Valid_Email.
 *
 * Valid URL links open in a new tab with `target="_blank" rel="noopener noreferrer"`
 * (21.4, 22.4, 25.4, 26.2, 29.8). Pass `external={false}` to open in the same tab.
 * Email links never set a target.
 *
 * When the value is not valid, the component renders plain text in a `<span>`: `fallback` when
 * given, otherwise `children`, otherwise the value itself. It renders nothing when that text is
 * empty. Callers that must omit a link for an empty value (22.5, 26.3) check the value first.
 *
 * @param {{ href?: unknown, kind?: 'url' | 'email', external?: boolean, fallback?: import('react').ReactNode,
 *           className?: string, children?: import('react').ReactNode }} props
 */
export function SafeLink({ href, kind = 'url', external = true, fallback, className, children, ...rest }) {
  const isEmail = kind === 'email';
  const valid = isEmail ? isValidEmail(href) : isValidUrl(href);

  if (!valid) {
    const text = fallback !== undefined ? fallback : (children ?? (typeof href === 'string' ? href : null));
    if (text === null || text === undefined || text === '' || text === false) return null;
    return <span className={className}>{text}</span>;
  }

  const content = children ?? href;
  if (isEmail) {
    return (
      <a {...rest} className={className} href={`mailto:${href}`}>
        {content}
      </a>
    );
  }

  const newTab = external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
  return (
    <a {...rest} className={className} href={href} {...newTab}>
      {content}
    </a>
  );
}

export default SafeLink;
