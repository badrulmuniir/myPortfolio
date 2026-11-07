import { useRef, useState } from 'react';
import { useInView } from '../../hooks/useInView.js';
import { isValidUrl } from '../../utils/url.js';
import { PLACEHOLDER_PROJECT } from '../../assets/placeholders.js';

/**
 * Image for a Database-sourced URL with lazy loading and a placeholder (9.7, 35.5, 35.6).
 *
 * - `src` not a Valid_URL (empty, `javascript:`, relative, ...): shows `placeholder` at once
 *   and never requests `src` (22.2, 24.5, 25.7, 26.6).
 * - `src` valid: shows `placeholder` until `useInView` reports the image in the viewport, then
 *   sets `src`. An image outside the viewport at first render is therefore not requested until
 *   it is scrolled into view (35.5). Lazy loading uses IntersectionObserver, not the native
 *   `loading="lazy"` attribute, whose distance threshold starts requests early.
 * - `eager`: sets a valid `src` at once (above-the-fold images such as the Profile image).
 * - Load error: swaps to `placeholder` and keeps it until `src` changes (35.6).
 *
 * `alt` is used for the image and its placeholder alike, so an informative image and its
 * placeholder both name the subject; decorative images and Skill icons pass `alt=""` (34.5).
 * Pass a placeholder from `assets/placeholders.js`; the default is the project placeholder.
 * Sizing comes from CSS (`img { max-width: 100%; height: auto }`, 33.6); `width` and `height`
 * are passed through as attributes.
 *
 * @param {{ src?: unknown, alt?: string, placeholder?: string, className?: string,
 *           width?: number | string, height?: number | string, eager?: boolean }} props
 */
export function LazyImage({
  src,
  alt = '',
  placeholder = PLACEHOLDER_PROJECT,
  className,
  width,
  height,
  eager = false,
  ...rest
}) {
  const ref = useRef(null);
  const inView = useInView(ref);
  // The src that failed to load. Comparing with the current src resets the failure when src changes.
  const [failedSrc, setFailedSrc] = useState(null);

  const valid = isValidUrl(src);
  const showReal = valid && failedSrc !== src && (eager || inView);
  const currentSrc = showReal ? src : placeholder;

  const handleError = () => {
    if (showReal) setFailedSrc(src);
  };

  return (
    <img
      {...rest}
      ref={ref}
      src={currentSrc}
      alt={alt}
      className={className}
      width={width}
      height={height}
      decoding="async"
      onError={handleError}
    />
  );
}

export default LazyImage;
