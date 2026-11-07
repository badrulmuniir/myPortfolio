import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListEditor } from './ListEditor.jsx';

function Harness({ initial = [], maxItems, errors, onChangeSpy }) {
  const [items, setItems] = useState(initial);
  return (
    <ListEditor
      id="features"
      label="Features"
      itemLabel="Feature"
      items={items}
      maxItems={maxItems}
      errors={errors}
      onChange={(next) => {
        onChangeSpy?.(next);
        setItems(next);
      }}
    />
  );
}

const values = () => screen.getAllByRole('textbox').map((input) => input.value);

describe('ListEditor', () => {
  it('labels each item and names its buttons with the item number', () => {
    render(<Harness initial={['Auth', 'Search']} />);
    expect(screen.getByRole('group', { name: 'Features' })).toBeTruthy();
    expect(screen.getByLabelText('Feature 1').value).toBe('Auth');
    expect(screen.getByLabelText('Feature 2').value).toBe('Search');
    expect(screen.getByRole('button', { name: 'Remove Feature 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move up Feature 1' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Move down Feature 1' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Move up Feature 2' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Move down Feature 2' }).disabled).toBe(true);
  });

  it('adds an item with the keyboard and focuses its input', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['Auth']} />);
    screen.getByRole('button', { name: 'Add feature' }).focus();
    await user.keyboard('{Enter}');

    const input = screen.getByLabelText('Feature 2');
    expect(document.activeElement).toBe(input);
    await user.keyboard('Dark mode');
    expect(values()).toEqual(['Auth', 'Dark mode']);
  });

  it('moves items up and down in the shown order and keeps focus on the moved item', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={['A', 'B', 'C']} onChangeSpy={onChange} />);

    screen.getByRole('button', { name: 'Move down Feature 1' }).focus();
    await user.keyboard('{Enter}');
    expect(values()).toEqual(['B', 'A', 'C']);
    expect(onChange).toHaveBeenLastCalledWith(['B', 'A', 'C']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move down Feature 2' }));

    await user.keyboard(' '); // Space moves it down again, to the last place
    expect(values()).toEqual(['B', 'C', 'A']);
    // Move down is now disabled on the last item, so focus moves to its Move up button.
    expect(screen.getByRole('button', { name: 'Move down Feature 3' }).disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move up Feature 3' }));

    await user.keyboard('{Enter}');
    expect(values()).toEqual(['B', 'A', 'C']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move up Feature 2' }));
  });

  it('removes an item and focuses the neighbor, then the Add button when empty', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['A', 'B']} />);

    await user.click(screen.getByRole('button', { name: 'Remove Feature 1' }));
    expect(values()).toEqual(['B']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Feature 1' }));

    await user.keyboard('{Enter}');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add feature' }));
  });

  it('disables Add at the maximum', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['A']} maxItems={2} />);
    const add = screen.getByRole('button', { name: 'Add feature' });
    await user.click(add);
    expect(values()).toEqual(['A', '']);
    expect(add.disabled).toBe(true);
    expect(screen.getByText('2 of 2 used')).toBeTruthy();
  });

  it('shows list and per-item errors using validator keys', () => {
    render(
      <Harness initial={['A', '']} errors={{ features: 'Must have at most 30 items', 'features[1]': 'This field is required' }} />,
    );
    expect(screen.getByText('Must have at most 30 items')).toBeTruthy();
    const second = screen.getByLabelText('Feature 2');
    expect(second.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(second.getAttribute('aria-describedby')).textContent).toBe('This field is required');
    expect(screen.getByLabelText('Feature 1').getAttribute('aria-invalid')).toBe(null);
  });
});
