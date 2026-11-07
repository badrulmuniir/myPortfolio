import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useInView } from './useInView.js';

class MockIntersectionObserver {
  static instances = [];

  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.elements = [];
    this.disconnected = false;
    MockIntersectionObserver.instances.push(this);
  }

  observe(el) {
    this.elements.push(el);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  fire(isIntersecting) {
    this.callback(
      this.elements.map((target) => ({ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 })),
      this,
    );
  }
}

function Probe({ rootMargin }) {
  const ref = useRef(null);
  const inView = useInView(ref, { rootMargin });
  return <div ref={ref} data-testid="probe" data-in-view={String(inView)} />;
}

const state = () => screen.getByTestId('probe').getAttribute('data-in-view');

afterEach(() => {
  vi.unstubAllGlobals();
  MockIntersectionObserver.instances = [];
});

describe('useInView', () => {
  it('becomes true once the element intersects, then stays true and disconnects', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    render(<Probe rootMargin="10px" />);

    expect(state()).toBe('false');
    const [observer] = MockIntersectionObserver.instances;
    expect(observer.elements).toEqual([screen.getByTestId('probe')]);
    expect(observer.options.rootMargin).toBe('10px');

    act(() => observer.fire(false));
    expect(state()).toBe('false');

    act(() => observer.fire(true));
    expect(state()).toBe('true');
    expect(observer.disconnected).toBe(true);

    act(() => observer.fire(false));
    expect(state()).toBe('true');
    expect(MockIntersectionObserver.instances).toHaveLength(1);
  });

  it('returns true when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Probe />);
    expect(state()).toBe('true');
  });
});
