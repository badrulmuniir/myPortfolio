import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAsyncAction } from './useAsyncAction.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAsyncAction', () => {
  it('ignores further runs while one is pending and resolves with the action result', async () => {
    const d = deferred();
    const action = vi.fn(() => d.promise);
    const { result } = renderHook(() => useAsyncAction(action));

    let first;
    let second;
    act(() => {
      first = result.current.run('a');
      second = result.current.run('b'); // same tick, before a re-render
    });
    expect(result.current.pending).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith('a');
    await expect(second).resolves.toEqual({ status: 'ignored' });

    await act(async () => d.resolve('saved'));
    await expect(first).resolves.toEqual({ status: 'success', data: 'saved' });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('records the error, resets pending and allows another run after a failure', async () => {
    const failure = new Error('nope');
    const action = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce('ok');
    const { result } = renderHook(() => useAsyncAction(action));

    let outcome;
    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ status: 'error', error: failure });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe(failure);

    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ status: 'success', data: 'ok' });
    expect(result.current.error).toBe(null);
  });

  it('returns the outcome without state updates after unmount', async () => {
    const d = deferred();
    const { result, unmount } = renderHook(() => useAsyncAction(() => d.promise));
    let outcome;
    act(() => {
      outcome = result.current.run();
    });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    unmount();
    await act(async () => d.resolve(5));

    await expect(outcome).resolves.toEqual({ status: 'success', data: 5 });
    expect(result.current.pending).toBe(true); // last rendered value, no update after unmount
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
