import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
  MAX_NOTIFICATIONS,
  NotificationProvider,
  SUCCESS_DISMISS_MS,
  useNotify,
} from './NotificationContext.jsx';

let api;
function Capture() {
  api = useNotify();
  return (
    <button type="button" data-testid="focus-target">
      Focus me
    </button>
  );
}

const renderProvider = () =>
  render(
    <NotificationProvider>
      <Capture />
    </NotificationProvider>,
  );

const politeRegion = () => screen.getByRole('status');
const assertiveRegion = () => screen.getByRole('alert');

beforeEach(() => {
  vi.useFakeTimers();
  api = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NotificationProvider', () => {
  it('always renders a polite and an assertive live region', () => {
    renderProvider();
    expect(politeRegion().getAttribute('aria-live')).toBe('polite');
    expect(assertiveRegion().getAttribute('aria-live')).toBe('assertive');
    expect(within(politeRegion()).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(assertiveRegion()).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('shows a success notification in the polite region and removes it after 5 s', () => {
    renderProvider();
    act(() => {
      api.notify({ type: 'success', message: 'Project created' });
    });

    expect(within(politeRegion()).getByText('Project created')).toBeTruthy();
    expect(within(assertiveRegion()).queryByText('Project created')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(SUCCESS_DISMISS_MS - 1);
    });
    expect(within(politeRegion()).getByText('Project created')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Project created')).toBeNull();
  });

  it('keeps an error notification in the assertive region until it is closed', () => {
    renderProvider();
    act(() => {
      api.notify({ type: 'error', message: 'Delete failed' });
    });

    expect(within(assertiveRegion()).getByText('Delete failed')).toBeTruthy();
    expect(within(politeRegion()).queryByText('Delete failed')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(within(assertiveRegion()).getByText('Delete failed')).toBeTruthy();

    fireEvent.click(within(assertiveRegion()).getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Delete failed')).toBeNull();
  });

  it('does not move keyboard focus when a notification appears', () => {
    renderProvider();
    const target = screen.getByTestId('focus-target');
    target.focus();

    act(() => {
      api.notify({ type: 'success', message: 'Saved' });
      api.notify({ type: 'error', message: 'Failed' });
    });

    expect(document.activeElement).toBe(target);
  });

  it('dismiss(id) removes the notification and clears its timer', () => {
    renderProvider();
    let id;
    act(() => {
      id = api.notify({ type: 'success', message: 'Skill updated' });
    });
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      api.dismiss(id);
    });
    expect(screen.queryByText('Skill updated')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps the list, dropping the oldest success notification first', () => {
    renderProvider();
    act(() => {
      api.notify({ type: 'error', message: 'error 0' });
      for (let i = 1; i <= MAX_NOTIFICATIONS; i += 1) {
        api.notify({ type: 'success', message: `success ${i}` });
      }
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(MAX_NOTIFICATIONS);
    expect(screen.getByText('error 0')).toBeTruthy();
    expect(screen.queryByText('success 1')).toBeNull();
    expect(screen.getByText(`success ${MAX_NOTIFICATIONS}`)).toBeTruthy();
    expect(vi.getTimerCount()).toBe(MAX_NOTIFICATIONS - 1);
  });

  it('clears every timer on unmount and ignores notify afterwards', () => {
    const { unmount } = renderProvider();
    act(() => {
      api.notify({ type: 'success', message: 'one' });
      api.notify({ type: 'success', message: 'two' });
    });
    expect(vi.getTimerCount()).toBe(2);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(api.notify({ type: 'success', message: 'late' })).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an unknown notification type', () => {
    renderProvider();
    expect(() => api.notify({ type: 'info', message: 'x' })).toThrow(TypeError);
  });
});

describe('useNotify', () => {
  it('throws a clear error outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Capture />)).toThrow(/inside a <NotificationProvider>/);
    } finally {
      spy.mockRestore();
    }
  });
});
