import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { useRouteFocus } from './useRouteFocus.js';

function Layout() {
  const mainRef = useRef(null);
  useRouteFocus(mainRef);
  return (
    <>
      <nav aria-label="Main">
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
        <Link to="/about?tab=2">About tab</Link>
      </nav>
      <main ref={mainRef} tabIndex={-1} data-testid="main">
        <Routes>
          <Route path="/" element={<h1>Home page</h1>} />
          <Route path="/about" element={<h1>About page</h1>} />
        </Routes>
      </main>
    </>
  );
}

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Layout />
    </MemoryRouter>,
  );

describe('useRouteFocus', () => {
  it('does not move focus on the first render', () => {
    renderAt('/');
    expect(document.activeElement).toBe(document.body);
  });

  it('focuses the main element after the pathname changes', async () => {
    const user = userEvent.setup();
    renderAt('/');

    await user.click(screen.getByRole('link', { name: 'About' }));

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('About page');
    expect(document.activeElement).toBe(screen.getByTestId('main'));
  });

  it('does not move focus when only the query string changes', async () => {
    const user = userEvent.setup();
    renderAt('/about');
    const link = screen.getByRole('link', { name: 'About tab' });

    await user.click(link);

    expect(document.activeElement).toBe(link);
  });
});
