// E3 M3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3, R4; the M3 entry): what a dashboard's views and
// its source sheet read of its live datasets. The renderer's tab owns the implementation (its H connector surface, the
// watches, the grants and the owner's Start); the editor reads it through this portable interface, so the chart view and
// the sheet stay free of window.maws. A query's live status is transient presentation only: the descriptor in the doc
// stays the data's authority, and nothing here writes it.
import { DATASET_STATES } from '../states';

/** Why a live query's refreshes are paused, as the bridge last answered it (a closed list, never a server's words). */
export type LivePause = 'noRoute' | 'notAllowed' | 'allowChanged' | 'mayWrite' | 'watchLimit' | 'failed';

/** The owner's grant of the query's tool, as the host's grants read: a read grant, none, or not read yet. */
export type LivePermission = 'unknown' | 'read' | 'none';

/** One query dataset of the live document, as the tab follows it. */
export interface LiveQueryStatus {
  identity: string; // `queryIdentity` (../query.ts) of the live source
  server: string;
  tool: string;
  schedule?: number;
  snapshot: { ref: string; at: number } | null; // the live descriptor's (a sheet compares its capture with it)
  // E3 panel (Decision Log 16): the live descriptor's committed error in its source label's words (`datasetErrorOf`),
  // null when its state is none; the descriptor's, never the bridge's transient answer
  error: string | null;
  permission: LivePermission;
  pause: LivePause | null;
  busy: 'grant' | 'revoke' | 'refresh' | null; // an owner's gesture in flight
}

/** The owner's Start, as H's connector sheet keeps it. */
export type LiveStart =
  | { phase: 'idle' }
  | { phase: 'asking' }
  | { phase: 'starting' | 'ready'; appSessionId: string }
  | { phase: 'card' | 'refused'; appSessionId: string | null; words: string };

export interface LiveSnapshot {
  shown: boolean; // the tab's trusted visibility: on screen, its window's document visible, no history preview
  queries: ReadonlyMap<string, LiveQueryStatus>; // by dataset id
  needsStart: boolean; // some query found no live session
  start: LiveStart;
}

export interface LiveDatasets {
  subscribe(listener: () => void): () => void;
  snapshot(): LiveSnapshot;
  /** The time a live label is computed at (the stale boundary); a subscriber is told when a stale boundary passes while shown. */
  now(): number;
  grant(id: string): Promise<void>;
  revoke(id: string): Promise<void>;
  refresh(id: string): Promise<void>;
  start(): Promise<void>;
  openSession(appSessionId: string): void;
}

// E3 M3 fix: a refusal that says what is wrong, which a missing grant does not cover
const CONCRETE: readonly LivePause[] = ['mayWrite', 'failed', 'watchLimit'];

/** The pause a view says: a concrete refusal first (the tool may write, a failed refresh, the watch limit), then no read
 * grant, else what the bridge last answered. */
export function livePauseOf(status: LiveQueryStatus | undefined): LivePause | null {
  if (!status) return null;
  if (status.pause !== null && CONCRETE.includes(status.pause)) return status.pause;
  if (status.permission === 'none') return 'notAllowed';
  return status.pause;
}

const PAUSES: Record<LivePause, string> = {
  noRoute: DATASET_STATES.paused,
  notAllowed: DATASET_STATES.notAllowed,
  allowChanged: DATASET_STATES.allowChanged,
  mayWrite: DATASET_STATES.mayWrite,
  watchLimit: DATASET_STATES.watchLimit,
  failed: DATASET_STATES.refreshFailed,
};
export const livePauseLabel = (pause: LivePause): string => PAUSES[pause];

const UNITS = [
  [86_400, 'day'],
  [3_600, 'hour'],
  [60, 'minute'],
] as const;

/** The query's schedule in words: its largest whole unit, or manual. */
export function scheduleWords(schedule: number | undefined): string {
  if (schedule === undefined) return LIVE_COPY.manual;
  const [size, unit] = UNITS.find(([size]) => schedule % size === 0) ?? [1, 'second'];
  const count = schedule / size;
  return `Refreshes every ${count === 1 ? unit : `${count} ${unit}s`} while this dashboard is on screen`;
}

// Every sentence of the source sheet's live query block, in H's connector sheet's words where they say the same thing.
export const LIVE_COPY = {
  heading: 'Live query',
  manual: 'Refreshes only when you ask',
  allowedRead: 'Allowed to read',
  notAllowed: 'Not allowed',
  changed: 'Changed since you allowed it',
  checking: 'Checking permission…',
  allow: 'Allow',
  allowAgain: 'Allow again',
  revoke: 'Revoke',
  refresh: 'Refresh',
  start: 'Start session',
  openSession: 'Open session',
  asking: 'Starting…',
  starting: 'Starting the session…',
  ready: 'The session is ready',
  refreshing: 'Refreshing…',
  allowLabel: (name: string) => `Allow ${name} to read`,
  allowAgainLabel: (name: string) => `Allow ${name} again`,
  revokeLabel: (name: string) => `Revoke ${name}`,
  refreshLabel: (title: string) => `Refresh ${title}`,
  // the pause's explanation in the sheet (the view says the closed label)
  detail: {
    noRoute: 'No live session for this dashboard has this server. Start its session to read live data; no message is sent.',
    notAllowed: 'Allow it to read before this dashboard can refresh it.',
    allowChanged: 'Its server or tool changed since you allowed it.',
    mayWrite: 'This tool may change data, so it cannot refresh a dataset.',
    watchLimit: 'Too many live tools are open in MAWS; refresh it when fewer are.',
    failed: 'The last refresh did not reach the dashboard.',
  } satisfies Record<LivePause, string>,
  hidden: 'Refresh is available while this dashboard is on screen.',
  replaced: 'This query was replaced or removed after the source opened, so it cannot be refreshed from here.',
  showCurrent: 'Show current',
  newer: (at: string) => `Newer rows were fetched at ${at}; the rows here are the ones captured when the source opened.`,
  showLatest: 'Show latest',
} as const;
