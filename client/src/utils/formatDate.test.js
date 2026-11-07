import { afterEach, describe, expect, it } from 'vitest';
import { formatDateRange, formatMonthYear, formatYearRange } from './formatDate.js';

const RealDate = globalThis.Date;

describe('formatMonthYear', () => {
  it('formats the YYYY-MM part with a three-letter English month', () => {
    expect(formatMonthYear('2024-01-15')).toBe('Jan 2024');
    expect(formatMonthYear('2025-03-31')).toBe('Mar 2025');
  });

  it('maps every month number to its abbreviation', () => {
    const expected = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    expected.forEach((mon, index) => {
      const mm = String(index + 1).padStart(2, '0');
      expect(formatMonthYear(`2023-${mm}-10`)).toBe(`${mon} 2023`);
    });
  });

  it('keeps the stored month at day boundaries that shift in other time zones', () => {
    // new Date('2024-01-01') is 31 Dec 2023 in any zone west of UTC.
    expect(formatMonthYear('2024-01-01')).toBe('Jan 2024');
    expect(formatMonthYear('2023-12-31')).toBe('Dec 2023');
    expect(formatMonthYear('2024-02-29')).toBe('Feb 2024'); // leap day
    expect(formatMonthYear('2024-03-01')).toBe('Mar 2024');
  });

  it('reads only the leading date of a timestamp string', () => {
    expect(formatMonthYear('2024-06-01T00:00:00.000Z')).toBe('Jun 2024');
    expect(formatMonthYear('2024-06')).toBe('Jun 2024');
  });

  it('returns an empty string for malformed input without throwing', () => {
    for (const value of [
      '', '   ', '2024', '2024-13-01', '2024-00-10', '24-01-01', '2024/01/15', 'Jan 2024',
      '2024-1-15', null, undefined, 20240115, {}, new RealDate(2024, 0, 15),
    ]) {
      expect(formatMonthYear(value)).toBe('');
    }
  });
});

describe('formatDateRange', () => {
  it('joins start and end with a spaced en dash', () => {
    expect(formatDateRange('2024-01-15', '2025-03-01')).toBe('Jan 2024 – Mar 2025');
    expect(formatDateRange('2024-01-15', '2025-03-01')).toContain('\u2013');
  });

  it('shows Present when the end date is missing', () => {
    expect(formatDateRange('2024-01-15', null)).toBe('Jan 2024 – Present');
    expect(formatDateRange('2024-01-15', undefined)).toBe('Jan 2024 – Present');
    expect(formatDateRange('2024-01-15', '')).toBe('Jan 2024 – Present');
    expect(formatDateRange('2024-01-15')).toBe('Jan 2024 – Present');
  });

  it('returns an empty string when the start or a given end is malformed', () => {
    expect(formatDateRange('', '2025-03-01')).toBe('');
    expect(formatDateRange(null, null)).toBe('');
    expect(formatDateRange('2024-01-15', 'soon')).toBe('');
  });
});

describe('formatYearRange', () => {
  it('joins start and end years with a spaced en dash', () => {
    expect(formatYearRange(2019, 2023)).toBe('2019 – 2023');
    expect(formatYearRange('2019', '2023')).toBe('2019 – 2023');
  });

  it('shows Present when the end year is missing', () => {
    expect(formatYearRange(2021, null)).toBe('2021 – Present');
    expect(formatYearRange(2021, undefined)).toBe('2021 – Present');
    expect(formatYearRange('2021', '')).toBe('2021 – Present');
  });

  it('returns an empty string for malformed years without throwing', () => {
    expect(formatYearRange(null, 2023)).toBe('');
    expect(formatYearRange(999, 2023)).toBe('');
    expect(formatYearRange(2019.5, null)).toBe('');
    expect(formatYearRange('20x9', null)).toBe('');
    expect(formatYearRange(2019, 'later')).toBe('');
    expect(formatYearRange(2019, Number.NaN)).toBe('');
  });
});

describe('time-zone independence', () => {
  afterEach(() => {
    globalThis.Date = RealDate;
  });

  it('formats without constructing or calling Date', () => {
    globalThis.Date = function ForbiddenDate() {
      throw new Error('Date must not be used');
    };
    globalThis.Date.now = () => {
      throw new Error('Date must not be used');
    };

    expect(formatMonthYear('2024-01-01')).toBe('Jan 2024');
    expect(formatDateRange('2023-12-31', '2024-01-01')).toBe('Dec 2023 – Jan 2024');
    expect(formatDateRange('2024-02-29', null)).toBe('Feb 2024 – Present');
    expect(formatYearRange(2019, 2023)).toBe('2019 – 2023');
  });
});
