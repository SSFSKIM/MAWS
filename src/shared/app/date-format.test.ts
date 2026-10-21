// English throughout (P4 Decision Log 4): every age, date and time MAWS shows is written in the display locale, whatever
// the system's. This suite runs under the owner's Korean system locale (vitest.config.ts's `node-display` project), so
// each English expectation below is read where the system would have written Korean.
import { describe, expect, it } from 'vitest';
import { DISPLAY_LOCALE, dateFormats, dateTimeFormat, formatAgo, formatCalendarDay, formatClock, formatCompactCount, formatCount, formatDate, formatDateTime, formatDayTime, formatShortDate, formatUntil, formatWeekdayClock, formatWeekdayHour } from './date-format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const plain = (s: string) => s.replace(/\s/g, ' '); // Intl's narrow no-break space before AM and PM

describe('the display locale, under a Korean system locale', () => {
  const at = new Date(2026, 9, 6, 14, 5).getTime(); // Tuesday 2026-10-06 14:05 local
  const now = new Date(2026, 9, 9, 9, 0).getTime();

  it('runs where the system writes Korean', () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().locale).toBe('ko-KR');
    expect(new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })).toBe('10월 6일');
    expect(DISPLAY_LOCALE).toBe('en-US');
  });

  it('a clock time, a weekday with its clock or hour, a date and the whole date and time, in English', () => {
    expect(plain(formatClock(at))).toBe('2:05 PM');
    expect(plain(formatWeekdayClock(at))).toBe('Tue 2:05 PM');
    expect(plain(formatWeekdayHour(at))).toBe('Tue 2 PM');
    expect(formatDate(at)).toBe('Oct 6, 2026');
    expect(plain(formatDateTime(at))).toBe('Oct 6, 2026, 2:05 PM');
    expect(plain(formatDayTime(at))).toBe('Oct 6, 2:05 PM');
  });

  it('a short date names the year only outside the current one', () => {
    expect(formatShortDate(at, now)).toBe('Oct 6');
    expect(formatShortDate(new Date(2025, 11, 30, 10).getTime(), now)).toBe('Dec 30, 2025');
  });

  it('ages and countdowns, in English', () => {
    expect([0, 2 * MINUTE, 11 * HOUR, 2 * DAY, 15 * DAY].map((ms) => formatAgo(ms))).toEqual(['now', '2 minutes ago', '11 hours ago', '2 days ago', '2 weeks ago']);
    expect(formatAgo(3 * MINUTE, { narrow: true })).toBe('3m ago');
    expect(formatAgo(30_000, { seconds: true })).toBe('30 seconds ago');
    expect([10_000, 3 * MINUTE].map(formatUntil)).toEqual(['in <1m', 'in 3m']);
    expect([dateFormats().day(0), dateFormats().week(1), dateFormats().age(2 * HOUR)]).toEqual(['Today', 'Last week', '2h']);
  });

  it("a surface's own shape, built once in the display locale", () => {
    const longDay = dateTimeFormat({ month: 'long', day: 'numeric' });
    expect(longDay.format(at)).toBe('October 6');
    expect(dateTimeFormat({ month: 'long', day: 'numeric' })).toBe(longDay);
    expect(dateTimeFormat({ weekday: 'long', timeZone: 'UTC' }).format(Date.UTC(2026, 9, 6, 12))).toBe('Tuesday');
  });

  it('a calendar day as a medium date, with no zone shift; anything else is not one', () => {
    expect(formatCalendarDay('2026-10-12')).toBe('Oct 12, 2026');
    expect(formatCalendarDay('2026-01-01')).toBe('Jan 1, 2026');
    expect(['2026-10-1', 'soon', ''].map(formatCalendarDay)).toEqual([null, null, null]);
  });

  it('a count grouped, and a compact count to a tenth, in English', () => {
    expect([0, 999, 12_345, 1_234_567].map(formatCount)).toEqual(['0', '999', '12,345', '1,234,567']);
    expect([512, 36_800, 200_000, 1_000_000, 1_250_000].map(formatCompactCount)).toEqual(['512', '36.8K', '200K', '1M', '1.3M']);
  });
});

// The desk's counts are the module's too, so the switch that would make the page Korean makes them Korean with it.
describe('counts, in an explicit locale', () => {
  it('a compact count in the locale’s notation', () => {
    expect([36_800, 200_000].map((n) => dateFormats('en-US').compactCount(n))).toEqual(['36.8K', '200K']);
    expect([36_800, 200_000].map((n) => dateFormats('ko-KR').compactCount(n))).toEqual(['3.7만', '20만']);
  });
});

// Another locale's set, for the day a Korean UI changes DISPLAY_LOCALE (the owner, P4 Decision Log 4: "a Korean UI
// possible later"); the Korean Desktop reads "11시간 전" and "9월 27일" for "11 hours ago" and "Sep 27". Pinned in an
// English and a Korean locale.
describe('relative times and dates, in an explicit locale', () => {
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

  // under a minute (an overdue time included) keeps its own reading, not "in 1m" (the review of S-locale)
  it('a time to come: under a minute, then the largest whole unit', () => {
    const times = [10_000, 0, -30_000, MINUTE, 3 * MINUTE, 2 * HOUR, DAY];
    expect(times.map((ms) => en.until(ms))).toEqual(['in <1m', 'in <1m', 'in <1m', 'in 1m', 'in 3m', 'in 2h', 'in 1d']);
    expect(times.map((ms) => ko.until(ms))).toEqual(['<1분 후', '<1분 후', '<1분 후', '1분 후', '3분 후', '2시간 후', '1일 후']);
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
