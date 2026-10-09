// The renderer's dates and times follow the system locale (P2-D's ruling, 2026-10-09): expectations are computed with
// Intl's default locale, so the cases hold whatever locale the machine runs.
import { describe, expect, it } from 'vitest';
import { formatClock, formatDateTime, formatShortDate, formatWeekdayClock } from './date-format';

const system = (ms: number, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, options).format(ms);

describe('date formats', () => {
  const at = new Date(2026, 9, 6, 14, 5).getTime(); // Tuesday 2026-10-06 14:05 local
  const now = new Date(2026, 9, 9, 9, 0).getTime();

  it('a clock time, a weekday with its clock time and the medium date and time, in the system locale', () => {
    expect(formatClock(at)).toBe(system(at, { hour: 'numeric', minute: '2-digit' }));
    expect(formatWeekdayClock(at)).toBe(system(at, { weekday: 'short', hour: 'numeric', minute: '2-digit' }));
    expect(formatDateTime(at)).toBe(system(at, { dateStyle: 'medium', timeStyle: 'short' }));
  });

  it('a short date names the year only outside the current one', () => {
    expect(formatShortDate(at, now)).toBe(system(at, { month: 'short', day: 'numeric' }));
    const lastYear = new Date(2025, 11, 30, 10).getTime();
    expect(formatShortDate(lastYear, now)).toBe(system(lastYear, { month: 'short', day: 'numeric', year: 'numeric' }));
    expect(formatShortDate(lastYear, now)).toContain('2025');
  });
});
