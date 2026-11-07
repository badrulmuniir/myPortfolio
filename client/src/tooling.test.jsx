import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      Clicked {count} times
    </button>
  );
}

describe('test tooling', () => {
  it('renders React components in jsdom and handles user events', async () => {
    const user = userEvent.setup();
    render(<Counter />);

    const button = screen.getByRole('button', { name: 'Clicked 0 times' });
    await user.click(button);

    expect(screen.getByRole('button', { name: 'Clicked 1 times' })).toBe(button);
  });

  it('cleans up the DOM between tests', () => {
    expect(document.body.querySelector('button')).toBeNull();
  });

  it('configures fast-check to run at least 100 inputs per property', () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(100);
  });
});
