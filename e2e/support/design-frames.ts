// P3-E1 M6 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M6, acceptance 7): the scale gate's frame
// measures, read from a DevTools trace of the product window and from the page's own animation frames. Free of
// Playwright, so test/support/design-frames.test.ts checks every rule on tiny synthetic traces.
//
// Frame work. The window's renderer main thread is the one whose `blink.user_timing` marks bracket the gesture (the spec
// marks its start and end with `performance.mark`). Frames are the intervals between consecutive `BeginFrame` events of
// that renderer (its compositor's vsync-driven frames). A frame's work is the main thread's tasks that start in it, each
// read whole: the union of the top-level tasks (`RunTask`, else `ThreadControllerImpl::RunTask`; nested and overlapping
// slices counted once, tasks that only touch kept apart) taken as stretches of busy time, each stretch given in its whole
// length to the frame it starts in (one begun before the first frame and running into it is the first frame's), so React,
// style, layout and paint inside those tasks all count, and time the thread waits idle for the next frame does not.
// Nothing is clipped at a frame's end: a task longer than a frame reads its whole length in its first frame, and the
// frames it overruns read none of it, so a long task reads over a bound at any display rate. An active frame is one
// whose tasks handled input (an `EventDispatch` of a wheel or pointer event) or produced a frame (style, layout,
// pre-paint, paint, layerize or commit), anywhere in their length, in or out of the marked window; idle frames inside
// the window are kept in `all` but the bound is judged on the active ones.
//
// Dropped frames, two separately labelled readings: the compositor's own (its `PipelineReporter` frames and their
// `STATE_DROPPED` share, with the timeline's `DroppedFrame` instants beside it; null when the trace carries no reporter
// for the renderer, never zero), and the rAF-gap proxy (`rafDrops`): gaps between the page's animation frame callbacks
// longer than 1.5 calibrated intervals, each counting the frames it skipped, over the frames the gesture's span holds at
// that interval.

export interface TraceEvent {
  name: string;
  cat?: string;
  ph: string;
  ts: number; // µs
  dur?: number; // µs
  pid: number;
  tid: number;
  args?: Record<string, unknown>;
}

export interface Distribution {
  n: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

/** Nearest-rank percentiles (ms, one decimal place kept by the caller). */
export function distribution(values: number[]): Distribution {
  if (values.length === 0) return { n: 0, p50: NaN, p95: NaN, max: NaN, mean: NaN };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1]!, mean: sorted.reduce((s, v) => s + v, 0) / sorted.length };
}

export interface FrameWork {
  pid: number;
  tid: number;
  /** The marked window (ms from its start mark to its end mark). */
  windowMs: number;
  /** Each frame in the window: its start (ms from the start mark), length and main-thread work (ms), and whether active. */
  frames: { at: number; ms: number; workMs: number; active: boolean }[];
  all: Distribution;
  active: Distribution;
  /** The compositor's frames in the window: null when the trace has no PipelineReporter for this renderer. */
  compositor: { frames: number; dropped: number; droppedFrameEvents: number } | null;
  /** Input events the main thread dispatched in the window. */
  inputs: number;
}

const TASKS = ['RunTask', 'ThreadControllerImpl::RunTask'];
const PRODUCES = new Set(['UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'Commit']);
const INPUT = /^(wheel|mousewheel|pointermove|pointerdown|pointerup|mousemove|mousedown|mouseup)$/;

const eventType = (e: TraceEvent) => ((e.args?.data as { type?: unknown } | undefined)?.type as string | undefined) ?? '';

/** The union of [start, end) intervals, merged where they overlap; ones that only touch stay apart. */
function union(intervals: [number, number][]): [number, number][] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a < last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The frame work between two `performance.mark`s of the page (see the header); throws when the trace cannot say. */
export function frameWork(events: TraceEvent[], startMark: string, endMark: string): FrameWork {
  const marks = events.filter((e) => (e.cat ?? '').includes('blink.user_timing'));
  const start = marks.find((e) => e.name === startMark);
  const end = marks.find((e) => e.name === endMark);
  if (!start || !end) throw new Error(`the trace holds no ${!start ? startMark : endMark} mark`);
  if (start.pid !== end.pid || start.tid !== end.tid) throw new Error('the marks came from two threads');
  const { pid, tid } = start;
  const [t0, t1] = [start.ts, end.ts];
  const main = events.filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X' && typeof e.dur === 'number' && e.ts < t1 && e.ts + e.dur > t0);
  const name = TASKS.find((n) => main.some((e) => e.name === n));
  if (!name) throw new Error(`no top-level task (${TASKS.join(', ')}) on the renderer's main thread in the window`);
  const busy = union(main.filter((e) => e.name === name).map((e) => [e.ts, e.ts + e.dur!]));
  const begins = events.filter((e) => e.pid === pid && e.name === 'BeginFrame' && e.ts >= t0 && e.ts <= t1).map((e) => e.ts).sort((a, b) => a - b);
  const bounds = [...new Set(begins)];
  if (bounds.length < 2) throw new Error(`the trace holds ${bounds.length} BeginFrame for the renderer in the window: no frame to measure`);
  const signals = events
    .filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X' && typeof e.dur === 'number')
    .filter((e) => PRODUCES.has(e.name) || (e.name === 'EventDispatch' && INPUT.test(eventType(e))))
    .map((e) => [e.ts, e.ts + e.dur!] as [number, number]);
  // each stretch of busy time goes whole to the frame it starts in (the first, when it began before it and runs into it),
  // and makes that frame active by what it did anywhere in its length, even outside the marked window (signals are read
  // from every complete slice of the thread); one that ends before the first frame or starts at or after the last frame's
  // end belongs to no frame
  const workUs = new Array<number>(bounds.length - 1).fill(0);
  const active = new Array<boolean>(bounds.length - 1).fill(false);
  for (const [x, y] of busy) {
    if (y <= bounds[0]! || x >= bounds.at(-1)!) continue;
    const k = Math.max(0, bounds.findLastIndex((b) => b <= x));
    workUs[k] = workUs[k]! + y - x;
    if (signals.some(([s, e]) => s < y && e > x)) active[k] = true;
  }
  const frames = bounds.slice(0, -1).map((a, k) => ({ at: (a - t0) / 1000, ms: (bounds[k + 1]! - a) / 1000, workMs: workUs[k]! / 1000, active: active[k]! }));
  const reporters = events.filter((e) => e.pid === pid && e.name === 'PipelineReporter' && e.ph === 'b' && e.ts >= t0 && e.ts <= t1);
  const state = (e: TraceEvent) => (e.args?.chrome_frame_reporter as { state?: unknown } | undefined)?.state;
  const droppedFrameEvents = events.filter((e) => e.pid === pid && e.name === 'DroppedFrame' && e.ts >= t0 && e.ts <= t1).length;
  return {
    pid,
    tid,
    windowMs: (t1 - t0) / 1000,
    frames,
    all: distribution(frames.map((f) => f.workMs)),
    active: distribution(frames.filter((f) => f.active).map((f) => f.workMs)),
    compositor: reporters.length === 0 ? null : { frames: reporters.length, dropped: reporters.filter((e) => state(e) === 'STATE_DROPPED').length, droppedFrameEvents },
    inputs: main.filter((e) => e.name === 'EventDispatch' && INPUT.test(eventType(e))).length,
  };
}

export interface RafDrops {
  /** The calibrated idle interval (ms): the median gap of an idle run of animation frames. */
  intervalMs: number;
  /** The frames the gesture's span holds at that interval (the denominator). */
  expected: number;
  /** Frames skipped: each gap over 1.5 intervals counts round(gap / interval) − 1. */
  dropped: number;
  share: number;
  longestGapMs: number;
}

/** The rAF-gap dropped-frame proxy over `stamps` (one animation frame callback's timestamp each, ms). */
export function rafDrops(idle: number[], stamps: number[]): RafDrops {
  const gaps = (xs: number[]) => xs.slice(1).map((x, k) => x - xs[k]!);
  const idleGaps = gaps(idle);
  if (idleGaps.length < 10) throw new Error(`the idle calibration holds ${idleGaps.length} intervals, under 10`);
  const intervalMs = distribution(idleGaps).p50;
  const run = gaps(stamps);
  if (run.length === 0) throw new Error('the gesture produced no animation frame');
  const dropped = run.reduce((n, gap) => (gap > 1.5 * intervalMs ? n + Math.max(1, Math.round(gap / intervalMs) - 1) : n), 0);
  const expected = Math.max(1, Math.round((stamps.at(-1)! - stamps[0]!) / intervalMs));
  return { intervalMs, expected, dropped, share: dropped / expected, longestGapMs: Math.max(...run) };
}

/** A measured window on the test's clock (Date.now()): the gesture's own start and end. */
export interface Span {
  startedAt: number;
  endedAt: number;
}
/** What a contention run needs of each publication: when it was asked and when its answer came (the same clock). */
export interface Timed {
  requestedAt: number;
  answeredAt: number;
}

/**
 * The publications that ran wholly inside the measured window (asked at or after its start, answered by its end), by
 * their index in `all`, with the intervals between their requests: what a stress trial may claim as contention. A
 * publication before the gesture (during calibration or the trace's start) or still running at its end does not count.
 */
export function inside<T extends Timed>(all: readonly T[], span: Span): { indexes: number[]; count: number; intervalsMs: number[] } {
  const indexes = all.flatMap((p, k) => (p.requestedAt >= span.startedAt && p.answeredAt <= span.endedAt ? [k] : []));
  const intervalsMs = indexes.slice(1).map((k, j) => all[k]!.requestedAt - all[indexes[j]!]!.requestedAt);
  return { indexes, count: indexes.length, intervalsMs };
}

export interface RelayoutCallback {
  /** The callback's wall time on the main thread (`dur`): synchronous, so no scheduling wait; preemption would count. */
  wallMs: number;
  /** Its thread time (`tdur`, CPU), when the trace has it: recorded, not judged. */
  cpuMs: number | null;
  /** From the callback's start to the first board's listener: the measure and write phases ahead of any fit. */
  beforeFirstMarkMs: number;
  /** From the first board's listener to the last's. */
  marksSpanMs: number;
  enterToScopeMs: number;
  scopeToCallbackMs: number;
  /** The frame's own style, layout, pre-paint, paint, layerize and commit after the callback (to the renderer's next BeginFrame); null when no next frame is traced. */
  followingMs: number | null;
  /** The callback's id (`args.data.id`), for the trace's reader. */
  callback: unknown;
}

/**
 * DL39's re-layout pass, read from the trace (see the header's frame rules for the thread): the page marks `<run>:enter`
 * at the Enter, `<run>:scope` when the requested token stood in the design's scope style, and `<run>:layout:<board>:<n>`
 * at each canvas's `onLayout`. Each board's first layout after the scope stood must lie in one and the same
 * `FireAnimationFrame` callback of finite, positive duration on that thread; that callback's whole duration is the pass
 * (C's flushLayout measures every canvas, writes every canvas, then fits each, its listeners firing at each fit's end, so
 * the first listener comes after the measure and write phases). Anything else is refused by name: a missing or repeated
 * enter or scope mark, the scope before the Enter, a board with no layout after it, a mark at no finite time, layouts
 * spread over several callbacks, several callbacks holding them all, or none.
 */
export function relayoutCallback(events: TraceEvent[], run: string, boards: readonly string[]): RelayoutCallback {
  const marks = events.filter((e) => (e.cat ?? '').includes('blink.user_timing') && (e.name === `${run}:enter` || e.name === `${run}:scope` || e.name.startsWith(`${run}:layout:`)));
  const one = (what: 'enter' | 'scope') => {
    const found = marks.filter((e) => e.name === `${run}:${what}`);
    if (found.length !== 1) throw new Error(`the trace holds ${found.length} ${what} marks of ${run}, not 1`);
    return found[0]!;
  };
  const [enter, scope] = [one('enter'), one('scope')];
  const unread = marks.filter((e) => !Number.isFinite(e.ts));
  if (unread.length > 0) throw new Error(`a mark at not a finite time: ${unread.map((e) => e.name).join(', ')}`);
  if (scope.ts < enter.ts) throw new Error('the scope stood before the Enter: not this change’s');
  const { pid, tid } = scope;
  const firsts = new Map<string, number>();
  for (const e of marks) {
    const board = e.name.startsWith(`${run}:layout:`) ? e.name.slice(`${run}:layout:`.length).replace(/:\d+$/, '') : null;
    if (board === null || e.pid !== pid || e.tid !== tid || e.ts < scope.ts) continue;
    if (!firsts.has(board) || e.ts < firsts.get(board)!) firsts.set(board, e.ts);
  }
  const missing = boards.filter((b) => !firsts.has(b));
  if (missing.length > 0) throw new Error(`no layout after the scope stood: ${missing.join(', ')}`);
  const at = boards.map((b) => firsts.get(b)!);
  const [first, last] = [Math.min(...at), Math.max(...at)];
  const callbacks = events.filter((e) => e.name === 'FireAnimationFrame' && e.ph === 'X' && e.pid === pid && e.tid === tid && Number.isFinite(e.ts) && Number.isFinite(e.dur) && e.dur! > 0);
  const holds = (c: TraceEvent, t: number) => c.ts <= t && t <= c.ts + c.dur!;
  const holders = callbacks.filter((c) => holds(c, first) && holds(c, last));
  if (holders.length > 1) throw new Error(`${holders.length} callbacks hold every layout: ambiguous`);
  if (holders.length === 0) {
    const touched = callbacks.filter((c) => at.some((t) => holds(c, t)));
    throw new Error(touched.length > 1 ? `the layouts lie in ${touched.length} callbacks, not one pass` : 'no callback holds every layout');
  }
  const c = holders[0]!;
  const end = c.ts + c.dur!;
  const next = events.filter((e) => e.pid === pid && e.name === 'BeginFrame' && e.ts >= end).map((e) => e.ts).sort((a, b) => a - b)[0];
  const following =
    next === undefined
      ? null
      : union(events.filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X' && PRODUCES.has(e.name) && Number.isFinite(e.dur) && e.ts >= end && e.ts < next).map((e) => [e.ts, e.ts + e.dur!])).reduce((s, [a, b]) => s + (b - a), 0) / 1000;
  return {
    wallMs: c.dur! / 1000,
    cpuMs: Number.isFinite((c as { tdur?: number }).tdur) ? (c as { tdur?: number }).tdur! / 1000 : null,
    beforeFirstMarkMs: (first - c.ts) / 1000,
    marksSpanMs: (last - first) / 1000,
    enterToScopeMs: (scope.ts - enter.ts) / 1000,
    scopeToCallbackMs: (c.ts - scope.ts) / 1000,
    followingMs: following,
    callback: (c.args?.data as { id?: unknown } | undefined)?.id ?? null,
  };
}
