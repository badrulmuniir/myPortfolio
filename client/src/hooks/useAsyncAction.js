import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs a mutation (submit, delete, publish, mark-read) and tracks whether it is pending
 * (Requirements 29.4, 30.8, 31.13).
 *
 * @template T
 * @param {(...args: any[]) => Promise<T>} action The latest `action` is always used.
 * @returns {{
 *   run: (...args: any[]) => Promise<
 *     { status: 'success', data: T } | { status: 'error', error: unknown } | { status: 'ignored' }
 *   >,
 *   pending: boolean,
 *   error: unknown,
 * }}
 *
 * `run` never rejects. It resolves with an outcome object, so a click handler needs no
 * try/catch and an ignored call can never be mistaken for a success:
 * - `{ status: 'success', data }` when the action resolves.
 * - `{ status: 'error', error }` when the action rejects or throws; `error` is also kept in state.
 * - `{ status: 'ignored' }` when a previous run is still pending. The action is not called.
 *
 * `pending` becomes false again after success or failure. After unmount no state is updated,
 * but the outcome is still returned to the caller.
 */
export function useAsyncAction(action) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const actionRef = useRef(action);
  const pendingRef = useRef(false); // synchronous guard: two clicks in one tick still send one request
  const mountedRef = useRef(false);

  useEffect(() => {
    actionRef.current = action;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (...args) => {
    if (pendingRef.current) return { status: 'ignored' };
    pendingRef.current = true;
    if (mountedRef.current) {
      setPending(true);
      setError(null);
    }

    try {
      const data = await actionRef.current(...args);
      return { status: 'success', data };
    } catch (err) {
      if (mountedRef.current) setError(err);
      return { status: 'error', error: err };
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  }, []);

  return { run, pending, error };
}

export default useAsyncAction;
