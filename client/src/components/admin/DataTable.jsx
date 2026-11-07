import { EmptyState } from '../common/EmptyState.jsx';
import { ErrorState } from '../common/ErrorState.jsx';
import { LoadingIndicator } from '../common/LoadingIndicator.jsx';

const lower = (text) => (typeof text === 'string' ? text.toLowerCase() : 'items');

const errorMessage = (error) => {
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  return undefined; // ErrorState falls back to its generic message
};

const cellClass = (column) => column.className || undefined;

/**
 * Admin management table (Requirements 31.3, 31.14, 33.5).
 *
 * The table sits inside `<div class="table-scroll" role="region" aria-label={caption} tabIndex={0}>`,
 * so a table wider than its container scrolls inside it and every column, including the
 * Edit/Delete actions, stays reachable by mouse, touch and keyboard (33.5). The region is
 * always rendered, also while loading or showing an error, so it is a stable focus target:
 * pass `ref` and use it as the ConfirmDialog `returnFocusTo` for when a successful delete
 * removed the row's Delete button (31.6).
 *
 * Inside the region exactly one of these is shown, in this order of precedence (31.14):
 * - `loading` → a LoadingIndicator in place of the rows;
 * - `error` → an ErrorState with the error message and a Retry button calling `onRetry`.
 *   The caller handles 401 (session expiry) before it gets here;
 * - `rows` empty → an EmptyState with `emptyMessage` (which should name the content type);
 * - otherwise a `<table class="data-table">` with a `<caption>` (visually hidden unless
 *   `showCaption`), `<th scope="col">` headers and one row per record.
 *
 * Columns: `{ key, header, render?, className?, rowHeader? }`.
 * - A cell shows `render(row, rowIndex)` when given, otherwise `row[key]`.
 * - `className` is set on the header and body cells (`'data-table__actions'` for the action
 *   cell, `'data-table__numeric'` for numbers).
 * - `rowHeader: true` renders the body cell as `<th scope="row">` (use it for the name/title).
 * Row actions (Edit, Delete, View, publish) are rendered by the caller in a column's `render`.
 *
 * @param {{
 *   caption: string,
 *   columns: Array<{ key: string, header: import('react').ReactNode,
 *                    render?: (row: any, rowIndex: number) => import('react').ReactNode,
 *                    className?: string, rowHeader?: boolean }>,
 *   rows?: any[] | null,
 *   getRowKey?: (row: any, rowIndex: number) => string | number,
 *   rowClassName?: string | ((row: any, rowIndex: number) => string | undefined),
 *   loading?: boolean,
 *   error?: { message?: string } | string | null,
 *   onRetry?: () => void,
 *   emptyMessage?: string,
 *   loadingLabel?: string,
 *   showCaption?: boolean,
 *   className?: string,
 *   ref?: import('react').Ref<HTMLDivElement>,
 * }} props
 */
export function DataTable({
  caption,
  columns,
  rows,
  getRowKey = (row, index) => row?.id ?? index,
  rowClassName,
  loading = false,
  error = null,
  onRetry,
  emptyMessage,
  loadingLabel,
  showCaption = false,
  className,
  ref,
}) {
  const list = Array.isArray(rows) ? rows : [];

  let content;
  if (loading) {
    content = <LoadingIndicator label={loadingLabel ?? `Loading ${lower(caption)}…`} />;
  } else if (error) {
    content = <ErrorState message={errorMessage(error)} onRetry={onRetry} />;
  } else if (list.length === 0) {
    content = <EmptyState message={emptyMessage ?? `No ${lower(caption)} yet.`} />;
  } else {
    content = (
      <table className="data-table">
        <caption className={showCaption ? undefined : 'visually-hidden'}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cellClass(column)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((row, rowIndex) => {
            const rowClass = typeof rowClassName === 'function' ? rowClassName(row, rowIndex) : rowClassName;
            return (
              <tr key={getRowKey(row, rowIndex)} className={rowClass || undefined}>
                {columns.map((column) => {
                  const value = column.render ? column.render(row, rowIndex) : row?.[column.key];
                  return column.rowHeader ? (
                    <th key={column.key} scope="row" className={cellClass(column)}>
                      {value}
                    </th>
                  ) : (
                    <td key={column.key} className={cellClass(column)}>
                      {value}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <div
      ref={ref}
      className={className ? `table-scroll ${className}` : 'table-scroll'}
      role="region"
      aria-label={caption}
      aria-busy={loading ? 'true' : undefined}
      tabIndex={0}
    >
      {content}
    </div>
  );
}

export default DataTable;
