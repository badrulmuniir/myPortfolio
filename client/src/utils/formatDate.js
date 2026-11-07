// Date formatting for the public Experience and Education pages (27.3, 27.4, 28.2, 28.3).
//
// Every function reads the digits of the stored value directly and never builds a
// `Date`, so a visitor in any time zone sees the same month and year.
//
// Malformed input never throws: a value that cannot be read returns '' so the page
// shows nothing rather than "undefined" or "NaN". A range whose start, or whose
// non-empty end, is malformed also returns ''.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const PRESENT_LABEL = 'Present';
export const RANGE_SEPARATOR = ' – '; // spaces around an en dash (U+2013)

// `YYYY-MM`, optionally followed by `-DD` and anything after it (for example a time part).
const DATE_PATTERN = /^(\d{4})-(\d{2})(?:-|$)/;
const YEAR_PATTERN = /^\d{4}$/;

const isMissing = (value) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/**
 * Formats the `YYYY-MM` part of a `YYYY-MM-DD` string as "Mon YYYY", for example
 * '2024-01-15' → 'Jan 2024'. Returns '' for anything that is not a string starting
 * with a four-digit year and a month from 01 to 12.
 */
export function formatMonthYear(value) {
  if (typeof value !== 'string') return '';
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return '';
  const month = Number(match[2]);
  if (month < 1 || month > 12) return '';
  return `${MONTHS[month - 1]} ${match[1]}`;
}

/**
 * Formats a start date and optional end date as "Jan 2024 – Mar 2025", or
 * "Jan 2024 – Present" when the end is null, undefined or empty.
 */
export function formatDateRange(start, end) {
  const from = formatMonthYear(start);
  if (!from) return '';
  if (isMissing(end)) return `${from}${RANGE_SEPARATOR}${PRESENT_LABEL}`;
  const to = formatMonthYear(end);
  return to ? `${from}${RANGE_SEPARATOR}${to}` : '';
}

// Accepts a four-digit year as an integer or a string; returns '' otherwise.
function formatYear(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1000 && value <= 9999 ? String(value) : '';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return YEAR_PATTERN.test(trimmed) ? trimmed : '';
  }
  return '';
}

/**
 * Formats a start year and optional end year as "2019 – 2023", or "2021 – Present"
 * when the end is null, undefined or empty. Years may be integers or digit strings.
 */
export function formatYearRange(start, end) {
  const from = formatYear(start);
  if (!from) return '';
  if (isMissing(end)) return `${from}${RANGE_SEPARATOR}${PRESENT_LABEL}`;
  const to = formatYear(end);
  return to ? `${from}${RANGE_SEPARATOR}${to}` : '';
}
