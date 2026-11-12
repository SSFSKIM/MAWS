// The idle collection (P5 Decision Log 124, owed (2): O2's lever on V8's sizing; Decision Log 273's second entry). Each
// of MAWS's long-lived Node processes (`mawsd`, the engine host, the pty host) runs one memory-reducing collection when
// it goes idle by its own facts: once after its start, and again on each later return to idle. V8 sizes its young
// generation and keeps freed pages by the last active phase, and an idle process allocates too little to collect again,
// so without this it holds whatever its last collection happened to leave: in the daemon-idle scene one `mawsd` build
// read anywhere from 28 to 42 MB with its heap's live size the same, and `mawsd` alone sat at 46 MB with its start's
// 16 MB new space never shrunk. An entry that finds the heap, in use and in pages, within GROWTH_BYTES of what the last
// collection left collects nothing, so a client that comes and goes costs nothing after the first. Garbage neither size
// shows (a session released while the process stays idle, whose objects die without the heap growing) is the caller's
// to name: `dropped` collects past the guard.
//
// Two kinds of entry. The idle entry is the process's own idle predicate coming true (`set`). The quiet entry (Decision
// Log 273, for a process that opts in with `activity`) is a quiet period: ACTIVITY_QUIET_MS with no activity told (a
// command handled, an event passed on, work begun or ended), while the idle predicate may stay false, as it does for
// `mawsd` while any client stays connected. Its clock is armed by activity alone and runs out once per quiet period: a
// period that ends collects at most once (and nothing when the guard finds nothing grown), and the next is armed only
// by the next activity, so an idle process is never woken by it more than once after its last activity, and never
// periodically.
//
// A collection is synchronous (12 to 28 ms), so it must never land on work. The entry's telling can come late: a source
// can begin work before it tells (a send marks its use before its queue changes, and tells that only once its save
// settles). So the moment of collecting asks the process's own predicate again, over its live state: `quiet` for an idle
// entry; for a quiet one, its caller's `settled` (nothing in flight or running, clients or not), no work lifetime open
// (`work()`, for work that runs past a request or outside one: a response body still streaming, a sync with the hub),
// no activity told since the period ran out, and no I/O of the process's own in flight (a file read or write, a socket
// write not yet flushed: `ioInFlight`, which sees background work no caller tells, a periodic reconcile's or a watch
// callback's reads). A process it finds busy is not idle: an idle entry's collection waits for the next entry, a
// dropped holding still owed; a quiet one's for the next quiet period, which the work's end arms (the end of a request
// or of a work lifetime is activity), or, held off by I/O alone, is asked again IO_RETRY_MS later, IO_RETRIES times at
// most before the period is given up. A late signal can only delay a collection, never land one on work.
import { getHeapStatistics, setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

/** A collection that gives memory back: what an idle entry runs. */
export type Collect = () => void;

// How far the heap, in use or in pages, must have grown since the last collection for an entry to collect: a young
// generation's worth.
export const GROWTH_BYTES = 1 << 20;

// Decision Log 273: a quiet entry's period. Long enough that a burst of work, a person's or an agent's (seconds between
// its steps), has ended rather than paused, so the 12 to 28 ms collection lands after it; short enough that the garbage
// of a scene is given back well inside the measured scenes' 120 s settle, before their first sample.
export const ACTIVITY_QUIET_MS = 30_000;

// A quiet entry held off by the process's own I/O alone is asked again this much later, so many times at most (I/O that
// never settles, a socket write to a peer that stopped reading, must not become a clock).
export const IO_RETRY_MS = 1_000;
export const IO_RETRIES = 5;

// The kinds of libuv request `process.getActiveResourcesInfo()` lists while I/O is in flight: a file system request, a
// file handle's, a socket write or shutdown not yet flushed, a DNS lookup. Handles (sockets, servers, timers) are the
// process's standing state, not work, and are not among them.
const IO_REQUEST = /^(FSReq|FileHandle)|(WriteWrap|ShutdownWrap|GetAddrInfoReqWrap|GetNameInfoReqWrap|QueryWrap)$/;

/** Whether any of the process's own I/O is in flight now (the quiet entry's last check before it collects). */
export function ioInFlight(resources: readonly string[] = process.getActiveResourcesInfo()): boolean {
  return resources.some((type) => IO_REQUEST.test(type));
}

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
  // The process's quiet as its live state reads now, asked at the moment of collecting: the same facts its caller tells
  // through `set`, read from their sources (not from what was last told)
  quiet(): boolean;
  // Decision Log 273's quiet entry, for a process whose idle predicate can stay false with nothing happening (clients
  // connected): `settled` is its live state's answer to "nothing in flight or running now", asked at the moment of
  // collecting; without it `activity()` does nothing
  activity?: { settled(): boolean; quietMs?: number /* ACTIVITY_QUIET_MS */ };
  // test seams
  collect?: Collect; // lastResortCollect
  heap?(): HeapSize; // getHeapStatistics()
  defer?(run: () => void): void; // setImmediate: the entry's caller finishes its turn first
  now?(): number; // performance.now()
  timer?(run: () => void, ms: number): () => void; // an unref'd setTimeout, and its clear
  io?(): boolean; // ioInFlight
}

export interface IdleCollector {
  /**
   * The process's idle as its facts stand now, told at each reading of them (not only at a change). An entry (from busy,
   * from never told, or from a collection that found it busy) collects once.
   */
  set(idle: boolean): void;
  /**
   * Something happened (a command handled, an event passed on, work begun or ended): the quiet period starts again from
   * now, and its clock is armed if none is. Cheap, for every message.
   */
  activity(): void;
  /**
   * Work that runs past a request or outside one begins: activity now, the quiet entry held off while it is open, and
   * activity again at its end (the returned call, which a second time does nothing).
   */
  work(): () => void;
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
  const timer = options.timer ?? ((run: () => void, ms: number) => {
    const handle = setTimeout(run, ms);
    handle.unref(); // the process's own work keeps it alive, not this clock
    return () => clearTimeout(handle);
  });
  const quietMs = options.activity?.quietMs ?? ACTIVITY_QUIET_MS;
  const io = options.io ?? (() => ioInFlight());
  let idle: boolean | null = null;
  let deferred = false;
  let entry: 'idle' | 'quiet' | null = null; // what the queued run answers: an idle entry outranks a quiet one
  let forced = false; // a dropped holding is queued: the run skips the guard
  let stopped = false;
  let floor: HeapSize | null = null; // what the last collection left
  let lastActivity = 0; // when activity was last told (now()'s clock)
  let cancel: (() => void) | null = null; // the quiet period's clock, while armed
  let ranOut = 0; // when the last quiet period ran out: activity after it holds its collection off
  let open = 0; // work lifetimes begun and not ended
  let retries = 0; // this period's asks again, held off by I/O alone
  const mib = (bytes: number) => (bytes / 1_048_576).toFixed(1);
  // An entry that finds neither size grown by GROWTH_BYTES since the last collection has nothing to give back.
  const grown = (before: HeapSize) => floor === null || before.used >= floor.used + GROWTH_BYTES || before.physical >= floor.physical + GROWTH_BYTES;
  const run = () => {
    deferred = false;
    const kind = entry;
    entry = null;
    if (stopped) return;
    if (kind === 'idle') {
      if (idle !== true) return; // busy again before the loop turned
      if (!options.quiet()) {
        idle = false; // busy by its live state, told or not yet: the next reading that finds it quiet is an entry
        return;
      }
    } else {
      if (lastActivity >= ranOut || open > 0 || !options.activity!.settled()) return; // the work's end is activity: the next period answers it
      if (io()) {
        if (retries < IO_RETRIES && cancel === null) {
          retries += 1;
          arm(IO_RETRY_MS); // asked again unless activity comes first, which moves the period on
        }
        return;
      }
    }
    const before = heap();
    if (!forced && !grown(before)) return;
    const started = now();
    forced = false; // the collection attempt consumes the bypass, even if it fails
    try {
      collect();
    } catch (error) {
      options.log(`idle: the collection failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    floor = heap();
    options.log(`idle: collected in ${Math.round(now() - started)} ms, heap ${mib(before.physical)} to ${mib(floor.physical)} MiB (used ${mib(before.used)} to ${mib(floor.used)})${kind === 'quiet' ? `, after ${Math.round(quietMs / 1000)} s with no activity` : ''}`);
  };
  const queue = (kind: 'idle' | 'quiet') => {
    if (stopped) return;
    if (entry !== 'idle') entry = kind;
    if (deferred) return;
    deferred = true;
    defer(run);
  };
  // The quiet period's clock: armed by activity, it runs out once quietMs passed with none, and then stays unarmed until
  // the next activity. Activity while it is armed moves only `lastActivity`; the clock, when it fires early, waits out
  // the rest.
  const arm = (ms: number) => {
    cancel = timer(() => {
      cancel = null;
      if (stopped) return;
      const left = lastActivity + quietMs - now();
      if (left > 0) return arm(left);
      ranOut = now();
      queue('quiet');
    }, ms);
  };
  const activity = () => {
    if (stopped || options.activity === undefined) return;
    lastActivity = now();
    retries = 0;
    if (cancel === null) arm(quietMs);
  };
  return {
    set(next) {
      const entered = next && idle !== true;
      idle = next;
      if (entered) queue('idle');
    },
    activity,
    work() {
      if (stopped || options.activity === undefined) return () => {};
      open += 1;
      activity();
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        open -= 1;
        activity();
      };
    },
    dropped() {
      if (idle !== true) return; // the next entry weighs it
      forced = true;
      queue('idle');
    },
    stop() {
      stopped = true;
      forced = false;
      cancel?.();
      cancel = null;
    },
  };
}
