// The dashboard's error and status wording (P3-E2; parent §2 "Error and stale states", XE5: the states bind in meaning,
// their wording is E2's, in this one module the editor, the exporters, the host's answers and E3 reuse). Times are
// formatted in UTC, explicitly, so neither the machine's locale nor its time zone changes a label or an export.
import type { ColumnType, DatasetDescriptor, DatasetState } from './datasets';

export const DATASET_STATES = {
  noDataset: (id: string) => `no dataset "${id}"`,
  noColumn: (id: string, column: string) => `dataset "${id}" has no column "${column}"`,
  mismatches: (count: number, rows: number, column: string, type: ColumnType) => `${count} of ${rows} values in ${column} are not ${type}`,
  unreadable: (id: string) => `the file of "${id}" could not be read`,
  staleSince: (at: number) => `stale since ${utcTime(at)}`,
  paused: 'paused: no live session',
  notFetched: 'not fetched', // E3: a configured query before its first successful fetch (no snapshot, no rows)
  // E3 M3 (R4's closed permission strings): why a live query's refreshes pause, as its view says beside its state
  notAllowed: 'paused: not allowed',
  allowChanged: 'paused: changed since it was allowed',
  mayWrite: 'paused: the tool may change data',
  watchLimit: 'paused: too many live tools are open',
  refreshFailed: 'paused: the last refresh did not reach the dashboard',
} as const;

// P3-E2 M3: what a view says about the rows it could not draw as asked, drawn in place or noted under the figure.
export const VIEW_STATES = {
  missing: (count: number, column: string) => `${count} ${count === 1 ? 'row has' : 'rows have'} no ${column}; not drawn`,
  needs: (view: string, what: string) => `a ${view} view needs ${what}`,
  notNumbers: (column: string) => `${column} is not a number column`,
  empty: 'no rows to draw',
  tablePreview: (shown: number, total: number) => `first ${shown} of ${total} rows`, // a table view's bound (parent Decision Log 24)
  // past the small multiples' 24 panels (parent Decision Log 27); the view's rows stay whole in the source sheet
  tooManySeries: (count: number) => `too many series: ${count}; filter or aggregate`,
  seriesNamesShortened: 'some series names are shortened; the tips and the source table have them whole',
  // an aggregate past the largest number (parent Decision Log 27): the note on the view, the word in its cell
  overflow: (count: number, agg: string, column: string) => `${agg} of ${column} overflows in ${count} ${count === 1 ? 'group' : 'groups'}: too large to represent`,
  overflowCell: 'overflow',
  tooLarge: (count: number) => `${count} ${count === 1 ? 'value is' : 'values are'} too large to draw`,
  // E2 panel: a finite range no scale can span (a subnormal extent, or one not finite once made nice), drawn in place
  unsupportedDomain: (column: string) => `${column} has a numeric range that cannot be drawn`,
  noPositive: (column: string) => `no positive ${column} to draw`,
  slicesDropped: (count: number, column: string) => `${count} ${count === 1 ? 'slice has' : 'slices have'} no positive ${column}; not drawn`,
  slicesFolded: (count: number) => `${count} slices; the five largest are shown individually and the rest are drawn as one`,
  labelsShortened: 'some category labels are shortened; the source table has them whole',
  kept: 'The caption, comments and edits on this block are kept.',
} as const;

/**
 * The source label under a view (parent §2 "Views"): the dataset's title, where its snapshot came from, when and by whom
 * it was last bound, and its state when not `ok`. `by` is the actor's shown name (the human "You", a session its title).
 */
export function sourceLabel(descriptor: DatasetDescriptor, by: string, live?: { now: number; pause?: string | null }): string {
  const { source, state, updated } = descriptor;
  const from = source.kind === 'file' ? `from ${source.name}` : `${source.server} · ${source.tool}`;
  // E3: a query never fetched has no fetch time or author to name
  const parts = [descriptor.title, from, updated ? `updated ${utcTime(updated.at)} by ${by}` : DATASET_STATES.notFetched];
  // E3 M3 (R4): a live view's label at `now`: the stale time beside the operational state, and the live bridge's pause
  // after it (a closed string, said once); without `live` (an export, a history preview) E2's label as it was
  const staleSince = live ? datasetStateAt(descriptor, live.now).staleSince : undefined;
  if (staleSince !== undefined) parts.push(DATASET_STATES.staleSince(staleSince));
  const stored = state.status === 'stale' ? DATASET_STATES.staleSince(state.at) : state.status === 'paused' ? DATASET_STATES.paused : datasetErrorOf(state) /* E3 panel */;
  if (stored !== null && (staleSince === undefined || stored !== DATASET_STATES.staleSince(staleSince))) parts.push(stored);
  if (live?.pause && live.pause !== stored) parts.push(live.pause);
  return parts.join(' · ');
}

// E3 panel wave (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 16): the words of a dataset's
// recorded error, as its source label says them (the host's closed wording, else this fallback) and the source sheet's
// live block repeats them; null when its state is no error.
export function datasetErrorOf(state: DatasetState): string | null {
  return state.status === 'error' ? (state.message ?? 'the last refresh failed') : null;
}

// E3 start (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R4; E's Decision Log 48 (4)): the dataset's state
// as a view presents it at `now`, computed at render time and never written because the clock moved. `state` is the
// stored operational state (ok, error, paused) unchanged; `notFetched` a query with no snapshot yet; `staleSince`, when
// the snapshot is older than its `staleAfter` (from `snapshot.at + staleAfter`, not from a failed fetch), the time it
// became stale: a label shown beside the operational state, never replacing it. A dataset with no snapshot is never
// stale.
export interface DatasetPresentation {
  state: DatasetState;
  notFetched: boolean;
  staleSince?: number;
}

export function datasetStateAt(descriptor: DatasetDescriptor, now: number): DatasetPresentation {
  const { source, state } = descriptor;
  if (source.kind !== 'query') return { state, notFetched: false };
  if (source.snapshot === null) return { state, notFetched: true };
  if (source.staleAfter === undefined) return { state, notFetched: false };
  const since = source.snapshot.at + source.staleAfter * 1000;
  return now >= since ? { state, notFetched: false, staleSince: since } : { state, notFetched: false };
}
// E3 end

/** The descriptor's validation notes: "<n> of <rows> values in <column> are not <type>", one per column that has any. */
export function mismatchNotes(descriptor: DatasetDescriptor): string[] {
  return descriptor.columns.flatMap((column) => (column.mismatches ? [DATASET_STATES.mismatches(column.mismatches, descriptor.rows, column.name, column.type)] : []));
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** `2026-10-16 08:30 UTC`: an epoch time as every label and answer shows it. */
export function utcTime(at: number): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
