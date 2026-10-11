// The renderer's dates and times follow the system locale (P2-D's ruling, 2026-10-09): expectations are computed with
// Intl's default locale, so the cases hold whatever locale the machine runs.
import { describe, expect, it } from 'vitest';
import { dateFormats, formatClock, formatDateTime, formatShortDate, formatWeekdayClock } from './date-format';

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

// D2 widened (P2-F wave S, the owner at the sitting: "통일하고 P2에서 수정"): relative times and month-day dates follow
// the system display locale as well; the Korean Desktop reads "11시간 전" and "9월 27일" for the values the library
// showed as "10 hours ago" and "Sep 27". Pinned in an English and a Korean locale.
describe('relative times and dates, in an explicit locale', () => {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const en = dateFormats('en-US');
  const ko = dateFormats('ko-KR');

  it('an age in words: now under a minute, then minutes, hours, days and weeks', () => {
    const ages = [0, 59_000, MINUTE, 2 * MINUTE, HOUR, 11 * HOUR + 5 * MINUTE, DAY, 2 * DAY, 7 * DAY, 15 * DAY];
    expect(ages.map((ms) => en.ago(ms))).toEqual([
      'now', 'now', '1 minute ago', '2 minutes ago', '1 hour ago', '11 hours ago', '1 day ago', '2 days ago', '1 week ago', '2 weeks ago',
    ]);
    expect(ages.map((ms) => ko.ago(ms))).toEqual(['지금', '지금', '1분 전', '2분 전', '1시간 전', '11시간 전', '1일 전', '2일 전', '1주 전', '2주 전']);
  });

  it('the compact age, and an age counted in seconds under a minute', () => {
    expect([3 * MINUTE, 2 * HOUR, 3 * DAY].map((ms) => en.ago(ms, { narrow: true }))).toEqual(['3m ago', '2h ago', '3d ago']);
    expect([3 * MINUTE, 2 * HOUR, 3 * DAY].map((ms) => ko.ago(ms, { narrow: true }))).toEqual(['3분 전', '2시간 전', '3일 전']);
    expect([4_000, 30_000, 90_000].map((ms) => en.ago(ms, { seconds: true }))).toEqual(['now', '30 seconds ago', '1 minute ago']);
    expect([4_000, 30_000, 90_000].map((ms) => ko.ago(ms, { seconds: true }))).toEqual(['지금', '30초 전', '1분 전']);
  });

  it('a time to come, at least a minute away', () => {
    expect([10_000, 3 * MINUTE, 2 * HOUR, DAY].map((ms) => en.until(ms))).toEqual(['in 1m', 'in 3m', 'in 2h', 'in 1d']);
    expect([10_000, 3 * MINUTE, 2 * HOUR, DAY].map((ms) => ko.until(ms))).toEqual(['1분 후', '3분 후', '2시간 후', '1일 후']);
  });

  it('a calendar day relative to today, capitalised as a label', () => {
    expect([en.day(0), en.day(1)]).toEqual(['Today', 'Yesterday']);
    expect([ko.day(0), ko.day(1)]).toEqual(['오늘', '어제']);
  });

  it('a month and day, the year only outside the current one', () => {
    const at = new Date(2026, 8, 27, 14, 5).getTime();
    const now = new Date(2026, 9, 9, 9, 0).getTime();
    expect([en.shortDate(at, now), ko.shortDate(at, now)]).toEqual(['Sep 27', '9월 27일']);
    expect([en.shortDate(at, new Date(2027, 0, 2).getTime()), ko.shortDate(at, new Date(2027, 0, 2).getTime())]).toEqual(['Sep 27, 2026', '2026년 9월 27일']);
  });
});

describe('a dated year and an hour estimate, in an explicit locale', () => {
  it('a date with its year, and a weekday with its hour, in the locale', () => {
    const at = new Date(2026, 9, 8, 14, 5).getTime(); // Thursday
    expect([dateFormats('en-US').date(at), dateFormats('ko-KR').date(at)]).toEqual(['Oct 8, 2026', '2026년 10월 8일']);
    expect(dateFormats('en-US').weekdayHour(at).replace(/\s/g, ' ')).toBe('Thu 2 PM');
    expect(dateFormats('ko-KR').weekdayHour(at)).toMatch(/^\(목\) /);
  });
});

// The review of S-locale (the owner's ruling covers every relative time): compact ages and countdowns keep their
// compactness, their number and unit written by Intl's narrow unit style (2h; 2시간); the chooser's week headings are
// Intl's relative weeks. English output stays as it was.
describe('compact amounts, ages and week labels, in an explicit locale', () => {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const en = dateFormats('en-US');
  const ko = dateFormats('ko-KR');

  it('an amount of one unit, narrow', () => {
    const amounts = [[2, 'minute'], [2, 'hour'], [3, 'day'], [1, 'week']] as const;
    expect(amounts.map(([n, unit]) => en.amount(n, unit))).toEqual(['2m', '2h', '3d', '1w']);
    expect(amounts.map(([n, unit]) => ko.amount(n, unit))).toEqual(['2분', '2시간', '3일', '1주']);
  });

  it('the compact age: now under a minute, then the largest whole unit', () => {
    const ages = [0, 59_000, MINUTE, 59 * MINUTE, HOUR, 23 * HOUR, DAY, 7 * DAY, -5_000];
    expect(ages.map((ms) => en.age(ms))).toEqual(['now', 'now', '1m', '59m', '1h', '23h', '1d', '1w', 'now']);
    expect(ages.map((ms) => ko.age(ms))).toEqual(['지금', '지금', '1분', '59분', '1시간', '23시간', '1일', '1주', '지금']);
  });

  it('this week and last week as labels', () => {
    expect([en.week(0), en.week(1)]).toEqual(['This week', 'Last week']);
    expect([ko.week(0), ko.week(1)]).toEqual(['이번 주', '지난주']);
  });
});
