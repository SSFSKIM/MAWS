// Durations and time separators (C6 execution document, Copy and *Time separators* under Derivation). Separator labels
// depend on "now", the locale and the time zone, so they are configurable: the app leaves the defaults, the snapshot
// suite pins all three so a snapshot never depends on the machine that took it.

export interface TimeConfig {
  now: string; // ISO-8601
  locale: string;
  timeZone: string;
}

let config: TimeConfig | null = null;

export function configureTime(next: TimeConfig | null): void {
  config = next;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// `{t}` of the copy table: under a minute `45s`, under an hour `2m 14s`, else `1h 02m`.
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`;
}

export type SeparatorSubject = 'human' | 'engine' | 'peer' | 'loose';

// Codex's thresholds: an hour before a human turn, ten minutes before an engine turn or a loose row. The first row of
// a transcript always gets a separator.
export function needsSeparator(previousAt: string | null, at: string, subject: SeparatorSubject): boolean {
  if (previousAt === null) return true;
  const gap = Date.parse(at) - Date.parse(previousAt);
  return gap >= (subject === 'human' ? HOUR : 10 * MINUTE);
}

// Formatters are built once per (locale, zone, shape) and reused: the flat row list labels every separator on each
// flatten, and building a formatter costs far more than formatting with one (M6 profile: four per label cost about
// 12 ms per flatten of synthetic/500, and mounting a few receipts flattens several times in one frame).
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string | undefined, timeZone: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${timeZone ?? ''}|${JSON.stringify(options)}`;
  let format = formatters.get(key);
  if (!format) formatters.set(key, (format = new Intl.DateTimeFormat(locale, { ...options, timeZone })));
  return format;
}

// Calendar day of an instant in the configured zone (the system's when none is configured), as a day number, so
// "today" and "yesterday" follow the zone.
function dayNumber(ms: number, timeZone: string | undefined): number {
  const parts = formatter('en-US', timeZone, { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(ms));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Math.floor(Date.UTC(value('year'), value('month') - 1, value('day')) / DAY);
}

export function separatorLabel(at: string): string {
  const locale = config?.locale ?? undefined;
  const timeZone = config?.timeZone ?? undefined;
  const instant = Date.parse(at);
  const now = config ? Date.parse(config.now) : Date.now();
  const daysAgo = dayNumber(now, timeZone) - dayNumber(instant, timeZone);
  const time = formatter(locale, timeZone, { hour: 'numeric', minute: '2-digit' }).format(instant);
  let day: string;
  if (daysAgo === 0) day = 'Today';
  else if (daysAgo === 1) day = 'Yesterday';
  else if (daysAgo > 1 && daysAgo <= 6) day = formatter(locale, timeZone, { weekday: 'long' }).format(instant);
  else day = formatter(locale, timeZone, { year: 'numeric', month: 'short', day: 'numeric' }).format(instant);
  return `${day} ${time}`;
}
