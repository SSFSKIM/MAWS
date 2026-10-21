// Every age, date and time MAWS shows, in one locale (P4 Decision Log 4, the owner 2026-10-19: English throughout,
// relative ages included, whatever the system's locale; D2's system-locale ages are reversed). The shell, the library,
// the transcript, the editors and their history, the exports and main's own words format through this module: the
// named shapes below, or `dateTimeFormat` for a shape of a surface's own, so no other module builds a date formatter or
// calls `toLocale*String` on a date (eslint's `maws-dates/one-locale` holds it, a Date's `toLocaleString` aside, which
// it cannot tell from a number's). `DISPLAY_LOCALE` is the one switch: a Korean UI, if it comes, changes it here with
// the copy around it. Times are in the system's zone. Dates written for machines (ISO stamps in files, logs, protocol
// fields) are not this module's. One set of formatters per locale, built once; `dateFormats(locale)` builds another
// locale's set (this module's test pins the Korean forms). Compact ages and countdowns keep Intl's narrow unit style
// ("2h"). The budget's `clockTime` (budget/copy.ts) writes through `formatClock` (L129). The desk's web app
// (apps/desk-web) writes its times here too, and its counts (`formatCount`, `formatCompactCount`), so a page of it reads
// in one locale whatever the browser's; there the lint refuses every `toLocaleString` and `Intl.NumberFormat` as well.
export const DISPLAY_LOCALE = 'en-US';

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
  // A month, day and clock time, no year (Oct 6, 2:05 PM): a version's time, a restore's label, a build time.
  dayTime(ms: number): string;
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
  // A count, grouped: 12,345 (a compaction's tokens).
  count(n: number): string;
  // A count in compact notation, to a tenth: 36.8K, 200K, 1M (3.7만, 20만): a context window and its fill.
  compactCount(n: number): string;
}

function build(locale: string): DateFormats {
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const weekdayClock = new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const weekdayHour = new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric' });
  const shortDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  const shortDateYear = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const dayTime = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const long = new Intl.RelativeTimeFormat(locale, { style: 'long' });
  const narrow = new Intl.RelativeTimeFormat(locale, { style: 'narrow' });
  const auto = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const now = auto.format(0, 'second');
  const label = (s: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
  const count = new Intl.NumberFormat(locale);
  const compactCount = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
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
    dayTime: (ms) => dayTime.format(ms),
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
    count: (n) => count.format(n),
    compactCount: (n) => compactCount.format(n),
  };
}

const built = new Map<string, DateFormats>();
export function dateFormats(locale: string = DISPLAY_LOCALE): DateFormats {
  let formats = built.get(locale);
  if (!formats) built.set(locale, (formats = build(locale)));
  return formats;
}

const shown = dateFormats();
export const formatClock = shown.clock;
export const formatWeekdayClock = shown.weekdayClock;
export const formatWeekdayHour = shown.weekdayHour;
export const formatShortDate = shown.shortDate;
export const formatDate = shown.date;
export const formatDateTime = shown.dateTime;
export const formatDayTime = shown.dayTime;
export const formatAgo = shown.ago;
export const formatUntil = shown.until;
export const formatCount = shown.count;
export const formatCompactCount = shown.compactCount;

// A shape of a surface's own (the history's long day, the library's month headings, the transcript's separators in a
// pinned zone), in the display locale; built once per shape, building costing far more than formatting (M6).
const shapes = new Map<string, Intl.DateTimeFormat>();
export function dateTimeFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let format = shapes.get(key);
  if (!format) shapes.set(key, (format = new Intl.DateTimeFormat(DISPLAY_LOCALE, options)));
  return format;
}

// A calendar day written `2026-10-12` as a medium date (Oct 12, 2026), read with no time zone shift, as a document's
// date chip and its exports show it; null for anything that is not a calendar day.
export function formatCalendarDay(day: string): string | null {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
  return Number.isNaN(at) ? null : dateTimeFormat({ dateStyle: 'medium', timeZone: 'UTC' }).format(at);
}
