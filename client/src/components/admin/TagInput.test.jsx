import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagInput, filterSuggestions } from './TagInput.jsx';

const SUGGESTIONS = ['React', 'Redux', 'Node.js', 'PostgreSQL', 'react-router'];

function Harness({ initial = [], suggestions = SUGGESTIONS, max, onSubmit }) {
  const [tags, setTags] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <TagInput id="technologies" label="Technologies" tags={tags} onChange={setTags} suggestions={suggestions} max={max} />
      <output data-testid="tags">{tags.join('|')}</output>
    </form>
  );
}

const shownTags = () => screen.getByTestId('tags').textContent;

describe('TagInput', () => {
  it('adds a trimmed name with Enter without submitting the form', async () => {
    const user = userEvent.setup();
    let submitted = 0;
    render(<Harness onSubmit={() => (submitted += 1)} />);
    const input = screen.getByRole('combobox', { name: 'Technologies' });

    await user.type(input, '  Docker  {Enter}');

    expect(shownTags()).toBe('Docker');
    expect(input.value).toBe('');
    expect(submitted).toBe(0);
    expect(screen.getByRole('button', { name: 'Remove Docker' })).toBeTruthy();
  });

  it('adds with the Add button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'Vite');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(shownTags()).toBe('Vite');
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });

  it('rejects a case-insensitive duplicate with a message', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['React']} suggestions={[]} />);
    const input = screen.getByRole('combobox');

    await user.type(input, 'react{Enter}');

    expect(shownTags()).toBe('React');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('This technology is already listed');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);

    await user.type(input, 'x');
    expect(screen.queryByRole('alert')).toBe(null);
  });

  it('rejects empty and whitespace-only names', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');

    await user.type(input, '   {Enter}');
    expect(shownTags()).toBe('');
    expect(screen.getByRole('alert').textContent).toBe('Enter a technology name');
  });

  it('rejects names beyond the maximum count', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['A', 'B']} max={2} suggestions={[]} />);
    await user.type(screen.getByRole('combobox'), 'C{Enter}');
    expect(shownTags()).toBe('A|B');
    expect(screen.getByRole('alert').textContent).toBe('A project can have at most 2 technologies');
  });

  it('removes a tag and moves focus to the next Remove button, then to the input', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['React', 'Node.js']} />);

    await user.click(screen.getByRole('button', { name: 'Remove React' }));
    expect(shownTags()).toBe('Node.js');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Node.js' }));

    await user.keyboard('{Enter}');
    expect(shownTags()).toBe('');
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });

  it('suggests names containing the typed text, excluding added ones, and selects by keyboard', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['Redux']} />);
    const input = screen.getByRole('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');

    await user.type(input, 'RE');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const listbox = screen.getByRole('listbox', { name: 'Technologies' });
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['React', 'PostgreSQL', 'react-router']);

    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'React' }).id);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('option', { name: 'react-router' }).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowDown}'); // wraps to the first option
    expect(screen.getByRole('option', { name: 'React' }).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowUp}'); // wraps to the last option
    expect(screen.getByRole('option', { name: 'react-router' }).getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{Enter}');
    expect(shownTags()).toBe('Redux|react-router');
    expect(input.value).toBe('');
    expect(screen.queryByRole('listbox')).toBe(null);
    expect(document.activeElement).toBe(input);
  });

  it('closes suggestions with Escape and adds a clicked suggestion', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');

    await user.type(input, 'node');
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBe(null);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.value).toBe('node');

    await user.keyboard('{ArrowDown}');
    await user.click(screen.getByRole('option', { name: 'Node.js' }));
    expect(shownTags()).toBe('Node.js');
  });
});

describe('filterSuggestions', () => {
  it('matches case-insensitively, skips added names and repeats, and ignores blank text', () => {
    expect(filterSuggestions(['React', 'REACT', 'Preact', 'Vue'], ['vue'], 'reAc')).toEqual(['React', 'Preact']);
    expect(filterSuggestions(['React'], [], '   ')).toEqual([]);
    expect(filterSuggestions(['React', 'Preact'], ['react'], 'act')).toEqual(['Preact']);
  });
});
