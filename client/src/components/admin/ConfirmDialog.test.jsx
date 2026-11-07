import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog.jsx';

function Harness({ onConfirmSpy = () => {}, onCancelSpy = () => {}, removeRowOnConfirm = false, pending = false }) {
  const [open, setOpen] = useState(false);
  const [rowVisible, setRowVisible] = useState(true);
  const tableRef = useRef(null);
  return (
    <>
      <button type="button">Before</button>
      <div ref={tableRef} role="region" aria-label="Projects" tabIndex={0}>
        {rowVisible ? (
          <button type="button" onClick={() => setOpen(true)}>
            Delete Portfolio
          </button>
        ) : null}
      </div>
      <ConfirmDialog
        open={open}
        title="Delete project?"
        message="Portfolio will be deleted permanently."
        pending={pending}
        returnFocusTo={tableRef}
        onConfirm={() => {
          onConfirmSpy();
          if (removeRowOnConfirm) setRowVisible(false);
          setOpen(false);
        }}
        onCancel={() => {
          onCancelSpy();
          setOpen(false);
        }}
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    render(<ConfirmDialog open={false} title="Delete?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole('dialog')).toBe(null);
  });

  it('opens as a named modal dialog with focus on Cancel and keeps Tab inside', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Delete Portfolio' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete project?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-describedby')).textContent).toBe(
      'Portfolio will be deleted permanently.',
    );

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(document.activeElement).toBe(cancel);

    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('Escape calls onCancel, not onConfirm, and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onConfirmSpy={onConfirm} onCancelSpy={onCancel} />);
    const opener = screen.getByRole('button', { name: 'Delete Portfolio' });
    await user.click(opener);

    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBe(null);
    expect(document.activeElement).toBe(opener);
  });

  it('Cancel button closes without confirming', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onConfirmSpy={onConfirm} onCancelSpy={onCancel} />);
    const opener = screen.getByRole('button', { name: 'Delete Portfolio' });
    await user.click(opener);
    await user.keyboard('{Enter}'); // Enter on the focused Cancel button

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it('returns focus to returnFocusTo when the opener was removed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirmSpy={onConfirm} removeRowOnConfirm />);
    await user.click(screen.getByRole('button', { name: 'Delete Portfolio' }));

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Delete Portfolio' })).toBe(null);
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Projects' }));
  });

  it('disables Confirm and ignores Escape while pending, keeping focus in the dialog', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Delete skill?" pending onConfirm={onConfirm} onCancel={onCancel} />);

    const dialog = screen.getByRole('dialog', { name: 'Delete skill?' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm.disabled).toBe(true);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.click(confirm);
    await user.keyboard('{Escape}');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('uses custom labels', () => {
    render(
      <ConfirmDialog open title="Leave?" confirmLabel="Continue" cancelLabel="Stay" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stay' })).toBeTruthy();
  });
});
