// The engine's cron core restated (SPEC 22 §22.3; 2.1.287 cli.pretty.js 540467-540543), so MAWS reads a scheduled
// job's next run as the engine computes it (E7 execution document, Design §7). Pure; local time through `Date`, as the
// engine runs it. The engine's fire jitter (§22.7) is not modelled: the next match is what the cron says.

export interface ParsedCron {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[]; // 1-12
  dayOfWeek: number[]; // 0-6, 0 = Sunday
}

// A recurring job that is not `permanent` is deleted after its final fire once seven days old (§22.7, `recurringMaxAgeMs`).
export const RECURRING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const BOUNDS = [{ min: 0, max: 59 }, { min: 0, max: 23 }, { min: 1, max: 31 }, { min: 1, max: 12 }, { min: 0, max: 6 }] as const;
const SEARCH_BOUND = 527_040;

// One comma-separated field: `*` or `*/N`, `a-b` or `a-b/N`, a literal. Day-of-week alone accepts 7, folded to 0 per
// produced value (so `0-7` is every day). Null on any refused term or an empty set.
function parseField(field: string, { min, max }: { min: number; max: number }): number[] | null {
  const values = new Set<number>();
  const dayOfWeek = min === 0 && max === 6;
  for (const term of field.split(',')) {
    const wildcard = /^\*(?:\/(\d+))?$/.exec(term);
    if (wildcard) {
      const step = wildcard[1] ? parseInt(wildcard[1], 10) : 1;
      if (step < 1) return null;
      for (let v = min; v <= max; v += step) values.add(v);
      continue;
    }
    const range = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(term);
    if (range) {
      const [from, to, step] = [parseInt(range[1]!, 10), parseInt(range[2]!, 10), range[3] ? parseInt(range[3], 10) : 1];
      if (from > to || step < 1 || from < min || to > (dayOfWeek ? 7 : max)) return null;
      for (let v = from; v <= to; v += step) values.add(dayOfWeek && v === 7 ? 0 : v);
      continue;
    }
    if (/^\d+$/.test(term)) {
      let v = parseInt(term, 10);
      if (dayOfWeek && v === 7) v = 0;
      if (v < min || v > max) return null;
      values.add(v);
      continue;
    }
    return null;
  }
  return values.size === 0 ? null : [...values].sort((a, b) => a - b);
}

export function parseCron(text: string): ParsedCron | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const fields: number[][] = [];
  for (let i = 0; i < 5; i += 1) {
    const values = parseField(parts[i]!, BOUNDS[i]!);
    if (values === null) return null;
    fields.push(values);
  }
  return { minute: fields[0]!, hour: fields[1]!, dayOfMonth: fields[2]!, month: fields[3]!, dayOfWeek: fields[4]! };
}

// The first matching minute strictly after `fromMs`, or null within the engine's iteration bound: month, then day
// (Vixie OR when both day fields are restricted; "unrestricted" is a full set, by length), then hour, then minute,
// each miss skipping to the start of the next unit.
export function nextCronMatch(cron: ParsedCron, fromMs: number): number | null {
  const minutes = new Set(cron.minute);
  const hours = new Set(cron.hour);
  const days = new Set(cron.dayOfMonth);
  const months = new Set(cron.month);
  const weekdays = new Set(cron.dayOfWeek);
  const anyDay = cron.dayOfMonth.length === 31;
  const anyWeekday = cron.dayOfWeek.length === 7;
  const d = new Date(fromMs);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < SEARCH_BOUND; i += 1) {
    if (!months.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    const dayMatches = anyDay && anyWeekday ? true : anyDay ? weekdays.has(d.getDay()) : anyWeekday ? days.has(d.getDate()) : days.has(d.getDate()) || weekdays.has(d.getDay());
    if (!dayMatches) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!hours.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!minutes.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1);
      continue;
    }
    return d.getTime();
  }
  return null;
}

// When a recurring, non-permanent job created at `createdAtMs` expires (§22.7).
export function cronExpiry(createdAtMs: number): number {
  return createdAtMs + RECURRING_MAX_AGE_MS;
}
