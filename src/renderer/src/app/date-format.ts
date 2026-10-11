// Dates and times as the system writes them: the renderer's words are English and its dates and times follow the
// system locale, as macOS and the rest of MAWS do (the architect's ruling for P2-D, 2026-10-09; the owner runs a Korean
// locale). Relative times and month-day dates follow it too (D2 widened at the P2-F sitting: "2 hours ago" reads
// "2시간 전", "Sep 27" reads "9월 27일", as the Korean Desktop writes them); the words around them stay English.
// Compact ages and countdowns keep their compactness, their number and unit in Intl's narrow unit style ("2h", "2시간").
// The budget's `clockTime` (budget/copy.ts) writes through `formatClock` (L129). One set of formatters per locale,
// built once; the exports below are the system locale's, and `dateFormats(locale)` pins one for a test or a surface
// that carries its own locale (the transcript's).
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export type AmountUnit = 'minute' | 'hour' | 'day' | 'week';

// The largest unit `ms` holds at least one of, and how many (floored).
function unitOf(ms: number): [number, AmountUnit] {
  if (ms < HOUR) return [Math.floor(ms / MINUTE), 'minute'];
  if (ms < DAY) return [Math.floor(ms / HOUR), 'hour'];
  if (ms < WEEK) return [Math.floor(ms / DAY), 'day'];
  return [Math.floor(ms / WEEK), 'week'];
}

export interface DateFormats {
  // A clock time (2:05 PM; 오후 2:05).
  clock(ms: number): string;
  // A weekday with its clock time (Tue 2:05 PM).
  weekdayClock(ms: number): string;
  // A weekday with its hour, for an estimate (Tue 2 PM).
  weekdayHour(ms: number): string;
  // A short date (Oct 6; 10월 6일), with the year when it is not `now`'s (Dec 30, 2025).
  shortDate(ms: number, now: number): string;
  // A date with its year (Oct 6, 2026; 2026년 10월 6일).
  date(ms: number): string;
  // The whole date and time, for a title (Oct 6, 2026, 2:05 PM).
  dateTime(ms: number): string;
  // How long ago, from an elapsed `ms`: "now" under a minute, then "2 minutes ago" … "3 weeks ago" (2분 전, 3주 전);
  // `narrow` is the compact form ("2m ago"); `seconds` counts the first minute in seconds ("30 seconds ago"), "now"
  // under five.
  ago(ms: number, options?: { narrow?: boolean; seconds?: boolean }): string;
  // How long until, compact: "in 3m", "in 2h" (3분 후); under a minute, an overdue time included, "in <1m" (<1분 후).
  until(ms: number): string;
  // A calendar day `daysAgo` before today as a label: Today, Yesterday (오늘, 어제).
  day(daysAgo: 0 | 1): string;
  // A calendar week `weeksAgo` before this one as a label: This week, Last week (이번 주, 지난주).
  week(weeksAgo: 0 | 1): string;
  // An amount of one unit, compact: 2m, 2h, 3d, 1w (2분, 2시간, 3일, 1주).
  amount(count: number, unit: AmountUnit): string;
  // The compact age of an elapsed `ms`: "now" under a minute (지금), then the largest whole unit (2m, 2h; 2시간).
  age(ms: number): string;
}

function build(locale: string | undefined): DateFormats {
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const weekdayClock = new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const weekdayHour = new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric' });
  const shortDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  const shortDateYear = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const long = new Intl.RelativeTimeFormat(locale, { style: 'long' });
  const narrow = new Intl.RelativeTimeFormat(locale, { style: 'narrow' });
  const auto = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const now = auto.format(0, 'second');
  const label = (s: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
  const units = new Map<AmountUnit, Intl.NumberFormat>();
  const amount = (count: number, unit: AmountUnit) => {
    let format = units.get(unit);
    if (!format) units.set(unit, (format = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' })));
    return format.format(count);
  };
  return {
    clock: (ms) => clock.format(ms),
    weekdayClock: (ms) => weekdayClock.format(ms),
    weekdayHour: (ms) => weekdayHour.format(ms),
    shortDate: (ms, at) => (new Date(ms).getFullYear() === new Date(at).getFullYear() ? shortDate : shortDateYear).format(ms),
    date: (ms) => shortDateYear.format(ms),
    dateTime: (ms) => dateTime.format(ms),
    ago(ms, options = {}) {
      if (options.seconds && ms >= 5_000 && ms < MINUTE) return long.format(-Math.floor(ms / 1000), 'second');
      if (ms < MINUTE) return now;
      const [count, unit] = unitOf(ms);
      return (options.narrow ? narrow : long).format(-count, unit);
    },
    until(ms) {
      if (ms >= MINUTE) return narrow.format(...unitOf(ms));
      // the locale's "in 1m" with its number marked as under it (a locale that writes no number keeps its words)
      return narrow.formatToParts(1, 'minute').map((part) => (part.type === 'integer' ? `<${part.value}` : part.value)).join('');
    },
    day: (daysAgo) => label(auto.format(-daysAgo, 'day')),
    week: (weeksAgo) => label(auto.format(-weeksAgo, 'week')),
    amount,
    age(ms) {
      if (ms < MINUTE) return now;
      return amount(...unitOf(ms));
    },
  };
}

const built = new Map<string, DateFormats>();
export function dateFormats(locale?: string): DateFormats {
  const key = locale ?? '';
  let formats = built.get(key);
  if (!formats) built.set(key, (formats = build(locale)));
  return formats;
}

const system = dateFormats();
export const formatClock = system.clock;
export const formatWeekdayClock = system.weekdayClock;
export const formatWeekdayHour = system.weekdayHour;
export const formatShortDate = system.shortDate;
export const formatDate = system.date;
export const formatDateTime = system.dateTime;
export const formatAgo = system.ago;
export const formatUntil = system.until;
