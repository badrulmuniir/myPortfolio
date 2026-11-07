import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafeLink } from './SafeLink.jsx';

describe('SafeLink', () => {
  it.each(['https://github.com/jane', 'http://example.com/path?q=1'])('renders a new-tab link for %s', (href) => {
    render(<SafeLink href={href}>GitHub</SafeLink>);
    const link = screen.getByRole('link', { name: 'GitHub' });
    expect(link.getAttribute('href')).toBe(href);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('uses the URL as link text when there are no children', () => {
    render(<SafeLink href="https://example.com/" />);
    expect(screen.getByRole('link', { name: 'https://example.com/' })).toBeTruthy();
  });

  it('opens in the same tab when external is false', () => {
    render(<SafeLink href="https://example.com/" external={false}>Site</SafeLink>);
    const link = screen.getByRole('link', { name: 'Site' });
    expect(link.hasAttribute('target')).toBe(false);
    expect(link.hasAttribute('rel')).toBe(false);
  });

  it.each(['javascript:alert(1)', 'ftp://files.example.com', 'data:text/html,<b>x</b>', '/relative'])(
    'renders %s as plain text, not a link',
    (href) => {
      const { container } = render(<SafeLink href={href} />);
      expect(screen.queryByRole('link')).toBeNull();
      expect(container.textContent).toBe(href);
    },
  );

  it('shows children or fallback as plain text for an invalid value', () => {
    const { container, rerender } = render(<SafeLink href="javascript:alert(1)">GitHub</SafeLink>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.textContent).toBe('GitHub');

    rerender(<SafeLink href="javascript:alert(1)" fallback="not available">GitHub</SafeLink>);
    expect(container.textContent).toBe('not available');
  });

  it('renders nothing for an empty value without children', () => {
    const { container } = render(<SafeLink href="" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a mailto link for a valid email when kind="email", without a new tab', () => {
    render(<SafeLink kind="email" href="jane@example.com" />);
    const link = screen.getByRole('link', { name: 'jane@example.com' });
    expect(link.getAttribute('href')).toBe('mailto:jane@example.com');
    expect(link.hasAttribute('target')).toBe(false);
  });

  it('renders an invalid email as plain text', () => {
    const { container } = render(<SafeLink kind="email" href="not-an-email" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.textContent).toBe('not-an-email');
  });
});
