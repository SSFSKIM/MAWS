// P3-E1 M6 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M6, acceptance 7): the scale gate's frame
// measures, read from a DevTools trace of the product window and from the page's own animation frames. Free of
// Playwright, so test/support/design-frames.test.ts checks every rule on tiny synthetic traces.
//
// Frame work. The window's renderer main thread is the one whose `blink.user_timing` marks bracket the gesture (the spec
// marks its start and end with `performance.mark`). Frames are the intervals between consecutive `BeginFrame` events of
// that renderer (its compositor's vsync-driven frames). A frame's work is the main thread's executing time inside it: the
// union of its top-level tasks (`RunTask`, else `ThreadControllerImpl::RunTask`; nested and overlapping slices counted
// once), clipped to the frame, so React, style, layout and paint inside those tasks all count, and time the thread waits
// idle for the next frame does not. An active frame is one in which the main thread handled input (an `EventDispatch` of
// a wheel or pointer event) or produced a frame (style, layout, pre-paint, paint, layerize or commit); idle frames inside
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

/** The union of [start, end) intervals, merged. */
function union(intervals: [number, number][]): [number, number][] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
const overlap = (intervals: [number, number][], a: number, b: number) => intervals.reduce((sum, [x, y]) => sum + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);

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
  const signals = main
    .filter((e) => PRODUCES.has(e.name) || (e.name === 'EventDispatch' && INPUT.test(eventType(e))))
    .map((e) => [e.ts, e.ts + e.dur!] as [number, number]);
  const frames = bounds.slice(0, -1).map((a, k) => {
    const b = bounds[k + 1]!;
    return { at: (a - t0) / 1000, ms: (b - a) / 1000, workMs: overlap(busy, a, b) / 1000, active: signals.some(([x, y]) => x < b && y > a) };
  });
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
