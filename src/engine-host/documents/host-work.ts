// The host's own work beside an agent's tool call, named for the scale gates (P4-R6; the P4 composite spec
// docs/doperpowers/plans/2026-10-19-p4-smoothing.md, Decision Log 44). A stretch of the host's loop that an agent's batch
// can share is recorded with its start (performance.now()'s clock) and length while a seam watches (`watchHostWork`):
// the store's background tasks (the search mirror's refresh, a head rewrite, an unload, the maintenance pass, an auto
// version, the idle replica sweep), a read's block-index warm slices, a frame the host takes from a connection or an
// agent's replica applies, a commit with its fsync, a request main or a window made of the host (its synchronous part)
// and main's library text read, and V8's collections. A seam reads what overlapped a measured call (`hostWorkBetween`),
// so a slow row names what shared its loop. Entries may nest (a frame that evicts a document holds its unload); work
// under RECORD_FLOOR_MS is not kept, nor any that ended more than HORIZON_MS ago unless a measured call still holds its
// window (`holdHostWork`), so the record holds a few hundred entries and leaves the gate's heap rows as they were; past
// MAX_ENTRIES the oldest go and a window they overlapped is answered as partial. With no seam watching, `timed` is the
// call it wraps.
import { constants, PerformanceObserver, type PerformanceEntry } from 'node:perf_hooks';
import { MSG_ACK, MSG_AWARENESS, MSG_PROVISIONAL, MSG_RESTORED, MSG_SYNC } from '@artifacts/provider/frames';

export type HostWork =
  | 'mirror' // the search mirror's background refresh of one artifact (search.ts, P4-B4 Decision Logs 24 and 25)
  | 'mirror catch-up' // a search bringing one stale row up to date before it queries
  | 'head' // a head checkpoint rewritten after a commit (service.ts)
  | 'commit' // the store's commit, its fsync included
  | 'unload' // a document unloaded, its docs destroyed
  | 'maintenance' // a synchronous stretch of the nightly pass (maintenance.ts)
  | 'auto version' // an auto version written (store.ts)
  | 'warm' // one slice of a read's block-index warm (document-host.ts)
  | 'replica sweep' // the idle agent replicas closed
  | 'frame' // a frame the host took from a connection (a renderer's or an agent replica's)
  | 'replica' // a frame from the host applied on an agent's replica (replica.ts)
  | 'request' // the synchronous part of a request main or a window made of the host (the command the detail; index.ts)
  | 'library text' // main's library reading an artifact's text (library/reads.ts: the state read, then the extraction)
  | 'gc'; // a V8 collection's pause (its kind the detail)

export interface WorkEntry {
  what: HostWork;
  at: number;
  ms: number;
  detail?: string;
}

const RECORD_FLOOR_MS = 0.1;
const HORIZON_MS = 2_000;
const MAX_ENTRIES = 16_384;
const GC_KINDS: Record<number, string> = {
  [constants.NODE_PERFORMANCE_GC_MAJOR]: 'major',
  [constants.NODE_PERFORMANCE_GC_MINOR]: 'minor',
  [constants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental',
  [constants.NODE_PERFORMANCE_GC_WEAKCB]: 'weak callbacks',
};

let watchers = 0;
let entries: WorkEntry[] = [];
let gcObserver: PerformanceObserver | null = null;
const holds = new Map<number, number>(); // a measured call's hold → the start of its window
let nextHold = 1;
let lostThrough = -Infinity; // the latest end among entries MAX_ENTRIES pushed out

function takeCollections(list: readonly PerformanceEntry[]): void {
  for (const entry of list) {
    const kind = (entry as PerformanceEntry & { detail?: { kind?: number } }).detail?.kind;
    recordHostWork('gc', entry.startTime, entry.duration, kind === undefined ? undefined : (GC_KINDS[kind] ?? String(kind)));
  }
}

/** Starts recording (V8's collections among it) until the answered function is called. */
export function watchHostWork(): () => void {
  watchers += 1;
  if (!gcObserver) {
    gcObserver = new PerformanceObserver((list) => takeCollections(list.getEntries()));
    gcObserver.observe({ entryTypes: ['gc'] });
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    watchers -= 1;
    if (watchers > 0) return;
    gcObserver?.disconnect();
    gcObserver = null;
    entries = [];
    holds.clear();
    lostThrough = -Infinity;
  };
}

/** Keeps every entry that ends after `from` until the answered function is called (a measured call's window). */
export function holdHostWork(from: number): () => void {
  const hold = nextHold++;
  holds.set(hold, from);
  return () => void holds.delete(hold);
}

export function recordHostWork(what: HostWork, at: number, ms: number, detail?: string): void {
  if (watchers === 0 || ms < RECORD_FLOOR_MS) return;
  entries.push({ what, at, ms, ...(detail !== undefined && { detail }) });
  const keepFrom = Math.min(performance.now() - HORIZON_MS, ...holds.values());
  let old = 0;
  for (; old < entries.length - MAX_ENTRIES; old++) lostThrough = Math.max(lostThrough, entries[old]!.at + entries[old]!.ms);
  while (old < entries.length && entries[old]!.at + entries[old]!.ms < keepFrom) old += 1;
  if (old > 0) entries.splice(0, old);
}

/** `run`, timed as `what` while a seam watches; `detail` is read after it ran (it may name what `run` found). */
export function timed<T>(what: HostWork, run: () => T, detail?: () => string | undefined): T {
  if (watchers === 0) return run();
  const at = performance.now();
  try {
    return run();
  } finally {
    recordHostWork(what, at, performance.now() - at, detail?.());
  }
}

/** The work recorded that overlapped [from, to), collections not yet delivered to the observer included; `partial` when
 * MAX_ENTRIES pushed out an entry that may have overlapped it. */
export function hostWorkBetween(from: number, to: number): { work: WorkEntry[]; partial: boolean } {
  if (gcObserver) takeCollections(gcObserver.takeRecords());
  return { work: entries.filter((entry) => entry.at < to && entry.at + entry.ms > from), partial: lostThrough > from };
}

const SYNC_KINDS = ['step1', 'step2', 'update'];
const FRAME_KINDS: Record<number, string> = { [MSG_AWARENESS]: 'awareness', [MSG_ACK]: 'ack', [MSG_RESTORED]: 'restored', [MSG_PROVISIONAL]: 'provisional' };

/** A frame's kind and size for the record, read from its first bytes (each kind's tag is one byte) without decoding it. */
export function frameLabel(data: unknown): string {
  if (!(data instanceof Uint8Array)) return 'a frame that is not bytes';
  const kind = data[0] === MSG_SYNC ? (SYNC_KINDS[data[1] ?? -1] ?? 'sync') : (FRAME_KINDS[data[0] ?? -1] ?? 'a frame');
  return `${kind}, ${data.length} bytes`;
}
