// When something happened, in English words ("2 weeks ago"; E11 F2b, plan 2.4). P2's surfaces write it in the system
// locale through `app/date-format.ts`'s `formatAgo` (D2 widened at the P2-F sitting); this English form is kept only
// for the browser chrome's bookmark sync line (`tools/browser/chrome/profile.ts`, the cua session's module, outside
// P2), until that session moves it to `formatAgo`.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function relativeAge(ms: number): string {
  const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return count(Math.floor(ms / MINUTE), 'minute');
  if (ms < DAY) return count(Math.floor(ms / HOUR), 'hour');
  if (ms < WEEK) return count(Math.floor(ms / DAY), 'day');
  return count(Math.floor(ms / WEEK), 'week');
}
