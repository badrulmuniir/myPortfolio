import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable } from './DataTable.jsx';

const columns = [
  { key: 'title', header: 'Title', rowHeader: true },
  { key: 'category', header: 'Category' },
  {
    key: 'actions',
    header: 'Actions',
    className: 'data-table__actions',
    render: (row) => (
      <button type="button" aria-label={`Delete ${row.title}`}>
        Delete
      </button>
    ),
  },
];

const rows = [
  { id: 1, title: 'Portfolio', category: 'Web', unread: true },
  { id: 2, title: 'CLI tool', category: 'Tools', unread: false },
];

describe('DataTable', () => {
  it('renders a captioned table with column headers inside a focusable scroll region', () => {
    const ref = createRef();
    render(
      <DataTable
        ref={ref}
        caption="Projects"
        columns={columns}
        rows={rows}
        rowClassName={(row) => (row.unread ? 'data-table__row--unread' : undefined)}
      />,
    );

    const region = screen.getByRole('region', { name: 'Projects' });
    expect(region.className).toContain('table-scroll');
    expect(region.tabIndex).toBe(0);
    expect(ref.current).toBe(region);

    const table = within(region).getByRole('table', { name: 'Projects' });
    expect(table.querySelector('caption').className).toBe('visually-hidden');
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((th) => th.textContent)).toEqual(['Title', 'Category', 'Actions']);
    headers.forEach((th) => expect(th.getAttribute('scope')).toBe('col'));

    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    expect(bodyRows[0].className).toBe('data-table__row--unread');
    expect(bodyRows[1].getAttribute('class')).toBe(null);
    expect(within(bodyRows[0]).getByRole('rowheader').textContent).toBe('Portfolio');
    expect(within(bodyRows[1]).getByRole('cell', { name: 'Tools' })).toBeTruthy();
    expect(within(bodyRows[1]).getByRole('button', { name: 'Delete CLI tool' })).toBeTruthy();
  });

  it('shows a loading indicator in place of the rows', () => {
    render(<DataTable caption="Projects" columns={columns} rows={rows} loading />);
    const region = screen.getByRole('region', { name: 'Projects' });
    expect(within(region).getByRole('status').textContent).toContain('Loading projects');
    expect(screen.queryByRole('table')).toBe(null);
  });

  it('shows an empty state naming the content', () => {
    render(<DataTable caption="Skills" columns={columns} rows={[]} emptyMessage="No skills yet." />);
    expect(screen.getByText('No skills yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBe(null);
  });

  it('shows the error message with a Retry button that calls onRetry', async () => {
    const onRetry = vi.fn();
    render(
      <DataTable
        caption="Projects"
        columns={columns}
        rows={[]}
        error={{ status: 500, message: 'The server could not be reached.' }}
        onRetry={onRetry}
      />,
    );
    const region = screen.getByRole('region', { name: 'Projects' });
    expect(within(region).getByRole('alert').textContent).toContain('The server could not be reached.');
    expect(screen.queryByRole('table')).toBe(null);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows a visible caption when asked', () => {
    render(<DataTable caption="Messages" columns={columns} rows={rows} showCaption />);
    expect(screen.getByRole('table').querySelector('caption').className).toBe('');
  });
});
