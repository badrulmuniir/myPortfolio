import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { formatPageTitle, usePageTitle } from './usePageTitle.js';

describe('formatPageTitle', () => {
  it('joins the page name and site title with " | "', () => {
    expect(formatPageTitle('About', 'My Portfolio')).toBe('About | My Portfolio');
  });

  it('uses the page name alone when the site title is empty or missing', () => {
    expect(formatPageTitle('Skills', '')).toBe('Skills');
    expect(formatPageTitle('Skills', '   ')).toBe('Skills');
    expect(formatPageTitle('Skills', undefined)).toBe('Skills');
    expect(formatPageTitle('Skills', null)).toBe('Skills');
  });

  it('uses the site title alone when there is no page name yet', () => {
    expect(formatPageTitle(null, 'My Portfolio')).toBe('My Portfolio');
    expect(formatPageTitle('', '')).toBe('');
  });
});

describe('usePageTitle', () => {
  beforeEach(() => {
    document.title = 'initial';
  });

  it('sets the page name alone while the site title is unavailable, then the full title', () => {
    const { rerender } = renderHook(({ page, site }) => usePageTitle(page, site), {
      initialProps: { page: 'Projects', site: undefined },
    });
    expect(document.title).toBe('Projects');

    rerender({ page: 'Projects', site: 'Jane Doe' });
    expect(document.title).toBe('Projects | Jane Doe');

    rerender({ page: 'Page not found', site: 'Jane Doe' });
    expect(document.title).toBe('Page not found | Jane Doe');
  });

  it('leaves the title unchanged when both values are empty', () => {
    renderHook(() => usePageTitle('', ''));
    expect(document.title).toBe('initial');
  });
});
