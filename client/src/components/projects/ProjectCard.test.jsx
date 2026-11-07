// ProjectCard tests (Requirements 25.2, 25.3, 25.4, 25.7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectCard, projectDetailsPath } from './ProjectCard.jsx';
import { PLACEHOLDER_PROJECT } from '../../assets/placeholders.js';

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

const IMAGE = 'https://images.example.com/shop.png';

const makeProject = (overrides = {}) => ({
  id: 1,
  title: 'Shop App',
  slug: 'shop-app',
  short_description: 'An online shop.',
  category: 'Web',
  image_url: IMAGE,
  github_url: 'https://github.com/dev/shop',
  live_demo_url: 'https://shop.example.com',
  technologies: [
    { id: 1, name: 'Node.js' },
    { id: 2, name: 'React' },
  ],
  ...overrides,
});

const renderCard = (project) =>
  render(
    <MemoryRouter>
      <ProjectCard project={project} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  MockIntersectionObserver.instances = [];
});

describe('ProjectCard', () => {
  it('shows title (h2), image alt, short description, category, technologies and links', () => {
    renderCard(makeProject());

    expect(screen.getByRole('heading', { level: 2, name: 'Shop App' })).toBeTruthy();
    expect(screen.getByText('An online shop.')).toBeTruthy();
    expect(screen.getByText('Web')).toBeTruthy();

    const techs = within(screen.getByRole('list', { name: 'Technologies' })).getAllByRole('listitem');
    expect(techs.map((li) => li.textContent)).toEqual(['Node.js', 'React']);

    const img = screen.getByRole('img', { name: 'Shop App' });
    act(() => MockIntersectionObserver.intersectAll());
    expect(img.getAttribute('src')).toBe(IMAGE);

    const details = screen.getByRole('link', { name: 'View Details' });
    expect(details.getAttribute('href')).toBe('/projects/shop-app');
    expect(details.getAttribute('target')).toBeNull();

    for (const [name, href] of [
      ['GitHub', 'https://github.com/dev/shop'],
      ['Live Demo', 'https://shop.example.com'],
    ]) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('shows no technology list for a project without technologies', () => {
    renderCard(makeProject({ technologies: [] }));
    expect(screen.queryByRole('list', { name: 'Technologies' })).toBeNull();
  });

  it('shows no GitHub or Live Demo link for empty URLs', () => {
    renderCard(makeProject({ github_url: '', live_demo_url: '' }));
    expect(screen.queryByText('GitHub')).toBeNull();
    expect(screen.queryByText('Live Demo')).toBeNull();
    expect(screen.getByRole('link', { name: 'View Details' })).toBeTruthy();
  });

  it('shows the placeholder with the title as alt for an empty image URL', () => {
    renderCard(makeProject({ image_url: '' }));
    act(() => MockIntersectionObserver.intersectAll());
    const img = screen.getByRole('img', { name: 'Shop App' });
    expect(img.getAttribute('src')).toBe(PLACEHOLDER_PROJECT);
  });

  it('swaps to the placeholder with the same alt when the image fails, keeping the rest of the card', () => {
    renderCard(makeProject());
    act(() => MockIntersectionObserver.intersectAll());
    const img = screen.getByRole('img', { name: 'Shop App' });
    expect(img.getAttribute('src')).toBe(IMAGE);

    fireEvent.error(img);
    const after = screen.getByRole('img', { name: 'Shop App' });
    expect(after.getAttribute('src')).toBe(PLACEHOLDER_PROJECT);
    expect(screen.getByRole('heading', { level: 2, name: 'Shop App' })).toBeTruthy();
    expect(screen.getByText('An online shop.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'GitHub' })).toBeTruthy();
  });

  it('renders HTML-like values as plain text', () => {
    const { container } = renderCard(
      makeProject({ title: '<b>Bold</b>', short_description: '<script>x()</script>' }),
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('<b>Bold</b>');
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('builds the details path from the Slug', () => {
    expect(projectDetailsPath('my-app-2')).toBe('/projects/my-app-2');
  });
});
