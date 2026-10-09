// Dates and times as the system writes them: the renderer's words are English and its dates and times follow the
// system locale, as macOS and the rest of MAWS do (the architect's ruling for P2-D, 2026-10-09; the owner runs a Korean
// locale). One formatter per shape, built once. Relative ages ("2h", "2 hours ago") are `sidebar/derive.ts`'s
// `formatAge` and `relative-age.ts`; the budget's 24-hour `clockTime` (budget/copy.ts) is its own fixed format.
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const WEEKDAY_CLOCK = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const SHORT_DATE_YEAR = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// A clock time (2:05 PM; 오후 2:05).
export const formatClock = (ms: number): string => CLOCK.format(ms);

// A weekday with its clock time (Tue 2:05 PM).
export const formatWeekdayClock = (ms: number): string => WEEKDAY_CLOCK.format(ms);

// A short date (Oct 6), with the year when it is not `now`'s (Dec 30, 2025).
export const formatShortDate = (ms: number, now: number): string =>
  (new Date(ms).getFullYear() === new Date(now).getFullYear() ? SHORT_DATE : SHORT_DATE_YEAR).format(ms);

// The whole date and time, for a title (Oct 6, 2026, 2:05 PM).
export const formatDateTime = (ms: number): string => DATE_TIME.format(ms);
