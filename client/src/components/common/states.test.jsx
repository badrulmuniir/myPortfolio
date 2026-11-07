import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadingIndicator } from './LoadingIndicator.jsx';
import { ErrorState, DEFAULT_ERROR_MESSAGE } from './ErrorState.jsx';
import { EmptyState } from './EmptyState.jsx';
import { MultilineText } from './MultilineText.jsx';

describe('LoadingIndicator', () => {
  it('announces its label in a polite status region', () => {
    render(<LoadingIndicator label="Loading projects" />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Loading projects');
  });

  it('has a default label', () => {
    render(<LoadingIndicator />);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });
});

describe('ErrorState', () => {
  it('shows the message in an alert and calls onRetry from the Retry button', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="The server could not be reached. Please try again." onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('The server could not be reached. Please try again.');

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('falls back to a generic message and omits Retry without a handler', () => {
    render(<ErrorState message="  " />);
    expect(screen.getByRole('alert').textContent).toContain(DEFAULT_ERROR_MESSAGE);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('EmptyState', () => {
  it('shows the message and optional actions', () => {
    render(
      <EmptyState message="No projects are available yet.">
        <a href="/">Home</a>
      </EmptyState>,
    );
    expect(screen.getByText('No projects are available yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
  });
});

describe('MultilineText', () => {
  it('keeps line breaks and shows HTML markup as literal text', () => {
    const text = 'First line\nSecond <b>bold</b> line';
    const { container } = render(<MultilineText text={text} />);
    const p = container.querySelector('p');
    expect(p.className).toBe('pre-line');
    expect(p.textContent).toBe(text);
    expect(p.querySelector('b')).toBeNull();
  });

  it('uses the given element and class', () => {
    const { container } = render(<MultilineText text="x" as="div" className="prose" />);
    expect(container.querySelector('div.pre-line.prose').textContent).toBe('x');
  });

  it.each(['', '   \n\t', null, undefined])('renders nothing for %j', (text) => {
    const { container } = render(<MultilineText text={text} />);
    expect(container.innerHTML).toBe('');
  });
});
