// The dashboard's error and status wording (P3-E2; parent §2 "Error and stale states", XE5: the states bind in meaning,
// their wording is E2's, in this one module the editor, the exporters, the host's answers and E3 reuse). Times are
// formatted in UTC, explicitly, so neither the machine's locale nor its time zone changes a label or an export.
import type { ColumnType } from './datasets';

export const DATASET_STATES = {
  noDataset: (id: string) => `no dataset "${id}"`,
  noColumn: (id: string, column: string) => `dataset "${id}" has no column "${column}"`,
  mismatches: (count: number, rows: number, column: string, type: ColumnType) => `${count} of ${rows} values in ${column} are not ${type}`,
  unreadable: (id: string) => `the file of "${id}" could not be read`,
  staleSince: (at: number) => `stale since ${utcTime(at)}`,
  paused: 'paused: no live session',
} as const;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** `2026-10-16 08:30 UTC`: an epoch time as every label and answer shows it. */
export function utcTime(at: number): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
