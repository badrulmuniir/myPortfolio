import { useEffect, useState } from 'react';

const hasIntersectionObserver = () => typeof globalThis.IntersectionObserver === 'function';

/**
 * Reports whether the element in `ref` has entered the viewport (Requirement 35.5).
 * Once it has intersected, the hook stays `true` and stops observing, so a lazy image keeps
 * its `src`. Without IntersectionObserver support it returns `true` at once so images still load.
 *
 * @param {{ current: Element | null }} ref
 * @param {{ rootMargin?: string, threshold?: number | number[] }} [options]
 * @returns {boolean}
 */
export function useInView(ref, { rootMargin = '0px', threshold = 0 } = {}) {
  const [inView, setInView] = useState(() => !hasIntersectionObserver());
  const thresholdKey = Array.isArray(threshold) ? threshold.join(',') : String(threshold);

  useEffect(() => {
    if (inView) return undefined;
    if (!hasIntersectionObserver()) {
      setInView(true);
      return undefined;
    }
    const element = ref.current;
    if (!element) return undefined;

    const observer = new globalThis.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
    // `thresholdKey` stands in for `threshold` so a new array literal does not re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, ref, rootMargin, thresholdKey]);

  return inView;
}

export default useInView;
