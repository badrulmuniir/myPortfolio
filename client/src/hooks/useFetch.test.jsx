import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useFetch } from './useFetch.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const snapshot = (r) => ({ loading: r.loading, data: r.data, error: r.error });

describe('useFetch', () => {
  it('starts loading with no data and no error, and passes an AbortSignal', () => {
    const fetcher = vi.fn(() => new Promise(() => {}));
    const { result } = renderHook(() => useFetch(fetcher, []));

    expect(snapshot(result.current)).toEqual({ loading: true, data: null, error: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it('ends with data and no error on success', async () => {
    const { result } = renderHook(() => useFetch(() => Promise.resolve({ id: 1 }), []));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(snapshot(result.current)).toEqual({ loading: false, data: { id: 1 }, error: null });
  });

  it('ends with an error and no data on failure', async () => {
    const failure = new Error('boom');
    const { result } = renderHook(() => useFetch(() => Promise.reject(failure), []));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(snapshot(result.current)).toEqual({ loading: false, data: null, error: failure });
  });

  it('treats a fetcher that throws synchronously as a failed request', async () => {
    const failure = new Error('sync');
    const { result } = renderHook(() =>
      useFetch(() => {
        throw failure;
      }, []),
    );

    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.loading).toBe(false);
  });

  it('retry hides the error, shows loading and repeats the request with the same params', async () => {
    const calls = [deferred(), deferred()];
    const fetcher = vi.fn((id) => calls[fetcher.mock.calls.length - 1].promise.then((v) => `${v}-${id}`));
    const { result } = renderHook(({ id }) => useFetch(() => fetcher(id), [id]), {
      initialProps: { id: 7 },
    });

    await act(async () => calls[0].reject(new Error('down')));
    expect(result.current.error).toBeInstanceOf(Error);

    act(() => result.current.retry());
    expect(snapshot(result.current)).toEqual({ loading: true, data: null, error: null });

    await act(async () => calls[1].resolve('ok'));
    expect(snapshot(result.current)).toEqual({ loading: false, data: 'ok-7', error: null });
    expect(fetcher.mock.calls).toEqual([[7], [7]]);
  });

  it('shows only the result for the latest params when responses arrive out of order', async () => {
    const pending = new Map();
    const signals = new Map();
    const fetchFor = (id, signal) => {
      const d = deferred();
      pending.set(id, d);
      signals.set(id, signal);
      return d.promise;
    };
    const { result, rerender } = renderHook(({ id }) => useFetch((signal) => fetchFor(id, signal), [id]), {
      initialProps: { id: 1 },
    });

    rerender({ id: 2 });
    expect(signals.get(1).aborted).toBe(true);
    expect(signals.get(2).aborted).toBe(false);

    await act(async () => pending.get(2).resolve('second'));
    await act(async () => pending.get(1).resolve('first'));

    expect(snapshot(result.current)).toEqual({ loading: false, data: 'second', error: null });
  });

  it('clears the previous result while the request for new params is loading', async () => {
    const { result, rerender } = renderHook(
      ({ id }) => useFetch(() => (id === 1 ? Promise.resolve('one') : new Promise(() => {})), [id]),
      { initialProps: { id: 1 } },
    );
    await waitFor(() => expect(result.current.data).toBe('one'));

    rerender({ id: 2 });
    expect(snapshot(result.current)).toEqual({ loading: true, data: null, error: null });
  });

  it('ignores an AbortError from a superseded request', async () => {
    const fetcher = (id, signal) =>
      id === 1
        ? new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
          )
        : Promise.resolve('fresh');
    const { result, rerender } = renderHook(({ id }) => useFetch((s) => fetcher(id, s), [id]), {
      initialProps: { id: 1 },
    });

    rerender({ id: 2 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(snapshot(result.current)).toEqual({ loading: false, data: 'fresh', error: null });
  });

  it('aborts on unmount and applies no late result', async () => {
    const d = deferred();
    let signal;
    const { result, unmount } = renderHook(() =>
      useFetch((s) => {
        signal = s;
        return d.promise;
      }, []),
    );
    const before = snapshot(result.current);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => d.resolve('late'));

    expect(snapshot(result.current)).toEqual(before);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('sends no request while disabled and starts once enabled', async () => {
    const fetcher = vi.fn(() => Promise.resolve('data'));
    const { result, rerender } = renderHook(({ enabled }) => useFetch(fetcher, [], { enabled }), {
      initialProps: { enabled: false },
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(snapshot(result.current)).toEqual({ loading: false, data: null, error: null });

    rerender({ enabled: true });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe('data'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('ends in one correct state under StrictMode double effects', async () => {
    const signals = [];
    const fetcher = vi.fn((signal) => {
      signals.push(signal);
      return Promise.resolve(`run-${signals.length}`);
    });
    const { result } = renderHook(() => useFetch(fetcher, []), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(signals.slice(0, -1).every((s) => s.aborted)).toBe(true);
    expect(snapshot(result.current)).toEqual({
      loading: false,
      data: `run-${signals.length}`,
      error: null,
    });
  });
});
