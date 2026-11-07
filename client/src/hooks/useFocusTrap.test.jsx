import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getFocusableElements, useFocusTrap } from './useFocusTrap.js';

function Dialog({ onClose, returnFocusTo }) {
  const ref = useRef(null);
  useFocusTrap(ref, { active: true, onEscape: onClose, returnFocusTo });
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="dlg-title" tabIndex={-1}>
      <h2 id="dlg-title">Delete item?</h2>
      <button type="button" onClick={onClose}>
        Confirm
      </button>
      <button type="button" disabled>
        Disabled
      </button>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

function Harness({ removeOpenerOnClose = false, onEscapeSpy }) {
  const [open, setOpen] = useState(false);
  const [openerVisible, setOpenerVisible] = useState(true);
  const tableRef = useRef(null);
  const close = () => {
    onEscapeSpy?.();
    if (removeOpenerOnClose) setOpenerVisible(false);
    setOpen(false);
  };
  return (
    <>
      <button type="button">Before</button>
      <table ref={tableRef} tabIndex={-1} aria-label="Items">
        <tbody>
          <tr>
            <td>
              {openerVisible && (
                <button type="button" onClick={() => setOpen(true)}>
                  Delete
                </button>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      <button type="button">After</button>
      {open && <Dialog onClose={close} returnFocusTo={tableRef} />}
    </>
  );
}

describe('useFocusTrap', () => {
  it('moves focus to the first focusable control and cycles Tab and Shift+Tab inside', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const confirm = screen.getByRole('button', { name: 'Confirm' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(confirm);

    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);
  });

  it('calls onEscape on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(<Harness onEscapeSpy={onEscape} />);
    const opener = screen.getByRole('button', { name: 'Delete' });
    await user.click(opener);

    await user.keyboard('{Escape}');

    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBe(null);
    expect(document.activeElement).toBe(opener);
  });

  it('returns focus to the fallback when the opener was removed', async () => {
    const user = userEvent.setup();
    render(<Harness removeOpenerOnClose />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(screen.queryByRole('button', { name: 'Delete' })).toBe(null);
    expect(document.activeElement).toBe(screen.getByRole('table', { name: 'Items' }));
  });
});

describe('getFocusableElements', () => {
  it('skips disabled, tabindex -1 and hidden elements', () => {
    const { container } = render(
      <div>
        <a href="/x">Link</a>
        <button type="button" disabled>
          Off
        </button>
        <span tabIndex={-1}>Skip</span>
        <div hidden>
          <button type="button">Hidden</button>
        </div>
        <input aria-label="Field" />
      </div>,
    );
    expect(getFocusableElements(container).map((el) => el.tagName)).toEqual(['A', 'INPUT']);
  });
});
