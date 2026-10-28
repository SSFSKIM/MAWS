// The idle collection (P5 Decision Log 124, owed (2): O2's lever on V8's sizing). Each of MAWS's long-lived Node
// processes (`mawsd`, the engine host, the pty host) runs one memory-reducing collection when it goes idle by its own
// facts: once after its start, and again on each later return to idle. V8 sizes its young generation and keeps freed
// pages by the last active phase, and an idle process allocates too little to collect again, so without this it holds
// whatever its last collection happened to leave: in the daemon-idle scene one `mawsd` build read anywhere from 28 to
// 42 MB with its heap's live size the same, and `mawsd` alone sat at 46 MB with its start's 16 MB new space never
// shrunk. No timer: an entry into idle is the only trigger, and an entry that finds the heap, in use and in pages, within
// GROWTH_BYTES of what the last collection left collects nothing, so a client that comes and goes costs nothing after
// the first. Garbage neither size shows (a session released while the process stays idle, whose objects die without
// the heap growing) is the caller's to name: `dropped` collects past the guard.
import { getHeapStatistics, setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

/** A collection that gives memory back: what an idle entry runs. */
export type Collect = () => void;

// How far the heap, in use or in pages, must have grown since the last collection for an entry to collect: a young
// generation's worth.
export const GROWTH_BYTES = 1 << 20;

type GcExtension = (options: { type: 'major'; execution: 'sync'; flavor: 'last-resort' }) => void;
let gc: GcExtension | null = null;

/**
 * V8's last-resort full collection (repeated mark-compacts that shrink the young generation and release pooled pages,
 * V8's response to a low-memory notification). Its gc extension is made for this module alone: `--expose-gc` is on only
 * while one fresh context is created, so this process's own context and every context made after hold no `gc`, and
 * nothing outside this closure can call it.
 */
export function lastResortCollect(): void {
  const started = (globalThis as { gc?: GcExtension }).gc; // a process started with --expose-gc (a test's) has one to use
  if (gc === null && typeof started === 'function') gc = started;
  if (gc === null) {
    setFlagsFromString('--expose-gc');
    try {
      gc = runInNewContext('gc') as GcExtension;
    } finally {
      setFlagsFromString('--no-expose-gc');
    }
  }
  gc({ type: 'major', execution: 'sync', flavor: 'last-resort' });
}

/** The heap as an entry weighs it: what is in use (live or not yet collected) and the pages V8 holds for it. */
export interface HeapSize {
  used: number; // v8's used_heap_size
  physical: number; // v8's total_physical_size
}

export interface IdleCollectorOptions {
  log(line: string): void;
  // test seams
  collect?: Collect; // lastResortCollect
  heap?(): HeapSize; // getHeapStatistics()
  defer?(run: () => void): void; // setImmediate: the entry's caller finishes its turn first
  now?(): number; // performance.now()
}

export interface IdleCollector {
  /** The process's idle as its facts stand now. An entry (from busy, or from never told) collects once. */
  set(idle: boolean): void;
  /** A holding was dropped while idle (a session released, a process ended): its garbage is collected, past the guard. */
  dropped(): void;
  /** The process is exiting: nothing collects from now on, a collection already queued included. */
  stop(): void;
}

export function idleCollector(options: IdleCollectorOptions): IdleCollector {
  const collect = options.collect ?? lastResortCollect;
  const heap = options.heap ?? ((): HeapSize => {
    const { used_heap_size: used, total_physical_size: physical } = getHeapStatistics();
    return { used, physical };
  });
  const defer = options.defer ?? ((run: () => void) => void setImmediate(run));
  const now = options.now ?? (() => performance.now());
  let idle: boolean | null = null;
  let deferred = false;
  let forced = false; // a dropped holding is queued: the run skips the guard
  let stopped = false;
  let floor: HeapSize | null = null; // what the last collection left
  const mib = (bytes: number) => (bytes / 1_048_576).toFixed(1);
  // An entry that finds neither size grown by GROWTH_BYTES since the last collection has nothing to give back.
  const grown = (before: HeapSize) => floor === null || before.used >= floor.used + GROWTH_BYTES || before.physical >= floor.physical + GROWTH_BYTES;
  const run = () => {
    deferred = false;
    const force = forced;
    forced = false;
    if (stopped || idle !== true) return; // exiting, or busy again before the loop turned
    const before = heap();
    if (!force && !grown(before)) return;
    const started = now();
    try {
      collect();
    } catch (error) {
      options.log(`idle: the collection failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    floor = heap();
    options.log(`idle: collected in ${Math.round(now() - started)} ms, heap ${mib(before.physical)} to ${mib(floor.physical)} MiB (used ${mib(before.used)} to ${mib(floor.used)})`);
  };
  const queue = () => {
    if (deferred || stopped) return;
    deferred = true;
    defer(run);
  };
  return {
    set(next) {
      const entered = next && idle !== true;
      idle = next;
      if (entered) queue();
    },
    dropped() {
      if (idle !== true) return; // the next entry weighs it
      forced = true;
      queue();
    },
    stop() {
      stopped = true;
    },
  };
}
