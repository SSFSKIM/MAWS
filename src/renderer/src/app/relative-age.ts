// When something happened, in words ("2 weeks ago"; E11 F2b, plan 2.4): an error's notice and the session's "Ended
// with an error" glyph read it. The compact form ("2w") is the sidebar's `formatAge`.
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
