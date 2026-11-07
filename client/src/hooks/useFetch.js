import { useCallback, useEffect, useRef, useState } from 'react';

const INITIAL_STATE = { loading: true, data: null, error: null };
const IDLE_STATE = { loading: false, data: null, error: null };

const isAbortError = (err) => err?.name === 'AbortError';

/**
 * Reusable data-fetching hook used by every Public_Site page (Requirement 32.11).
 *
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} fetcher Called with an AbortSignal for each run.
 *   The latest fetcher is always used, so an inline arrow function is fine; put the values
 *   it depends on in `deps`.
 * @param {unknown[]} [deps] Request parameters. A change starts a new request. Keep the array
 *   length constant between renders.
 * @param {{ enabled?: boolean }} [options] With `enabled: false` no request is sent and the
 *   state is idle: `{ loading: false, data: null, error: null }`.
 * @returns {{ loading: boolean, data: T | null, error: unknown, retry: () => void }}
 *
 * Contract:
 * - Starts as `{ loading: true, data: null, error: null }` and every finished request ends with
 *   `loading: false` and exactly one of `data` or `error` set (32.11).
 * - Each run gets its own AbortController and sequence number. A dependency change or unmount
 *   aborts the previous run, and only the result of the latest run is applied (32.14, 32.15).
 * - An AbortError and the result of an aborted run never change the state.
 * - `retry()` hides the error, shows loading and repeats the request with the same deps (32.9).
 * - A fetcher that throws synchronously is treated like a rejected request.
 */
export function useFetch(fetcher, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState(enabled ? INITIAL_STATE : IDLE_STATE);
  const [retryCount, setRetryCount] = useState(0);
  const fetcherRef = useRef(fetcher);
  const sequenceRef = useRef(0);

  // Keep the newest fetcher without restarting the request on every render.
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!enabled) {
      sequenceRef.current += 1; // invalidate any run still in flight
      setState((prev) => (prev === IDLE_STATE ? prev : IDLE_STATE));
      return undefined;
    }

    const sequence = ++sequenceRef.current;
    const controller = new AbortController();
    const isCurrent = () => !controller.signal.aborted && sequence === sequenceRef.current;

    // Clear the previous result so only data for the current parameters is shown.
    setState((prev) =>
      prev.loading && prev.data === null && prev.error === null ? prev : INITIAL_STATE,
    );

    let promise;
    try {
      promise = Promise.resolve(fetcherRef.current(controller.signal));
    } catch (err) {
      promise = Promise.reject(err);
    }

    promise.then(
      (data) => {
        if (isCurrent()) setState({ loading: false, data: data ?? null, error: null });
      },
      (err) => {
        if (!isCurrent() || isAbortError(err)) return;
        setState({ loading: false, data: null, error: err ?? new Error('Request failed') });
      },
    );

    return () => controller.abort();
    // `deps` is spread on purpose: the caller lists the request parameters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, retryCount, ...deps]);

  const retry = useCallback(() => setRetryCount((n) => n + 1), []);

  return { loading: state.loading, data: state.data, error: state.error, retry };
}

export default useFetch;
