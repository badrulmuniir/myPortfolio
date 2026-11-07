import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LazyImage } from './LazyImage.jsx';
import { PLACEHOLDER_ICON, PLACEHOLDER_PROFILE, PLACEHOLDER_PROJECT } from '../../assets/placeholders.js';

class MockIntersectionObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.elements = [];
    MockIntersectionObserver.instances.push(this);
  }

  observe(el) {
    this.elements.push(el);
  }

  unobserve() {}

  disconnect() {}

  static intersectAll() {
    for (const o of MockIntersectionObserver.instances) {
      o.callback(o.elements.map((target) => ({ target, isIntersecting: true, intersectionRatio: 1 })), o);
    }
  }
}

const URL_A = 'https://images.example.com/a.png';
const srcOf = (img) => img.getAttribute('src');

afterEach(() => {
  vi.unstubAllGlobals();
  MockIntersectionObserver.instances = [];
});

describe('LazyImage', () => {
  it('placeholders are distinct non-empty SVG URLs (a file URL or an inlined data URI)', () => {
    const all = [PLACEHOLDER_PROJECT, PLACEHOLDER_PROFILE, PLACEHOLDER_ICON];
    for (const p of all) {
      expect(typeof p).toBe('string');
      expect(p).toMatch(/\.svg|^data:image\/svg\+xml/);
    }
    expect(new Set(all).size).toBe(3);
  });

  it.each(['', undefined, 'javascript:alert(1)', 'data:image/png;base64,AAAA', '/relative.png', 'ftp://x.example.com/a.png'])(
    'shows the placeholder for the non-Valid_URL %j and never uses it as src',
    (src) => {
      vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
      render(<LazyImage src={src} alt="My Project" placeholder={PLACEHOLDER_PROFILE} eager />);
      const img = screen.getByRole('img', { name: 'My Project' });
      expect(srcOf(img)).toBe(PLACEHOLDER_PROFILE);

      act(() => MockIntersectionObserver.intersectAll());
      expect(srcOf(img)).toBe(PLACEHOLDER_PROFILE);
    },
  );

  it('does not set a valid src until the image intersects the viewport', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    render(<LazyImage src={URL_A} alt="Project A" />);
    const img = screen.getByRole('img', { name: 'Project A' });

    expect(srcOf(img)).toBe(PLACEHOLDER_PROJECT);
    expect(srcOf(img)).not.toBe(URL_A);
    expect(MockIntersectionObserver.instances[0].elements).toEqual([img]);

    act(() => MockIntersectionObserver.intersectAll());
    expect(srcOf(img)).toBe(URL_A);
    expect(img.hasAttribute('loading')).toBe(false);
  });

  it('loads at once when eager', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    render(<LazyImage src={URL_A} alt="Jane Doe" eager />);
    expect(srcOf(screen.getByRole('img', { name: 'Jane Doe' }))).toBe(URL_A);
  });

  it('swaps to the placeholder on a load error and keeps the alt text', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    render(<LazyImage src={URL_A} alt="Project A" eager />);
    const img = screen.getByRole('img', { name: 'Project A' });

    fireEvent.error(img);
    expect(srcOf(img)).toBe(PLACEHOLDER_PROJECT);
    expect(img.getAttribute('alt')).toBe('Project A');

    // An error on the placeholder itself does not loop or change anything.
    fireEvent.error(img);
    expect(srcOf(img)).toBe(PLACEHOLDER_PROJECT);
  });

  it('tries a new src again after an earlier src failed', () => {
    const { rerender } = render(<LazyImage src={URL_A} alt="P" eager />);
    const img = screen.getByRole('img', { name: 'P' });
    fireEvent.error(img);
    expect(srcOf(img)).toBe(PLACEHOLDER_PROJECT);

    rerender(<LazyImage src="https://images.example.com/b.png" alt="P" eager />);
    expect(srcOf(img)).toBe('https://images.example.com/b.png');
  });

  it('keeps empty alt text for decorative images and their placeholder', () => {
    const { container } = render(<LazyImage src="" alt="" placeholder={PLACEHOLDER_ICON} />);
    const img = container.querySelector('img');
    expect(img.getAttribute('alt')).toBe('');
    expect(srcOf(img)).toBe(PLACEHOLDER_ICON);
  });
});
