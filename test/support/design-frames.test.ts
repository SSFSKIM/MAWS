// P3-E1 M6 (e2e/support/design-frames.ts): the design scale gate's frame readings on tiny synthetic traces. A frame's work
// is the renderer main thread's executing time inside it (nested and overlapping tasks counted once, clipped to the
// frame), not the frame's length; idle frames are kept but the bound reads the active ones; the compositor's drops are
// reported only when the trace carries its reporter; the rAF proxy counts skipped frames against a calibrated interval.
import { describe, expect, it } from 'vitest';
import { distribution, frameWork, inside, rafDrops, type TraceEvent } from '../../e2e/support/design-frames';

const PID = 7;
const MAIN = 1;
const COMPOSITOR = 2;
const mark = (name: string, ts: number, tid = MAIN): TraceEvent => ({ name, cat: 'blink.user_timing', ph: 'R', ts, pid: PID, tid });
const begin = (ts: number, pid = PID): TraceEvent => ({ name: 'BeginFrame', cat: 'disabled-by-default-devtools.timeline.frame', ph: 'I', ts, pid, tid: COMPOSITOR });
const task = (ts: number, dur: number, name = 'RunTask', tid = MAIN, pid = PID): TraceEvent => ({ name, cat: 'disabled-by-default-devtools.timeline', ph: 'X', ts, dur, pid, tid });
const slice = (name: string, ts: number, dur: number, type?: string): TraceEvent => ({ name, cat: 'devtools.timeline', ph: 'X', ts, dur, pid: PID, tid: MAIN, ...(type && { args: { data: { type } } }) });
const reporter = (ts: number, state: string): TraceEvent => ({ name: 'PipelineReporter', cat: 'benchmark', ph: 'b', ts, pid: PID, tid: COMPOSITOR, args: { chrome_frame_reporter: { state } } });

/** Four 16 ms frames from t=0: a wheel frame with 3 ms of work (a nested RunTask inside), an idle one, a painting one with
 * 2 ms split by its boundary, and a frame where another renderer and another thread were busy. */
function trace(extra: TraceEvent[] = []): TraceEvent[] {
  return [
    mark('start', 0),
    begin(0),
    begin(16_000),
    begin(32_000),
    begin(48_000),
    begin(64_000),
    task(1_000, 3_000),
    task(1_500, 1_000), // nested in the one above: counted once
    slice('EventDispatch', 1_200, 2_000, 'wheel'),
    // frame 2 (16–32): nothing on the main thread
    task(46_000, 4_000), // 2 ms in frame 3, 2 ms in frame 4
    slice('Paint', 46_500, 1_000),
    task(50_000, 5_000, 'RunTask', 9), // another thread: not the main thread's work
    task(50_000, 5_000, 'RunTask', MAIN, 99), // another renderer
    begin(56_000, 99),
    mark('end', 64_000),
    ...extra,
  ];
}

describe('the frame work in a marked window', () => {
  it('reads each frame’s executing main-thread time, nested tasks once, clipped at the frame boundary', () => {
    const work = frameWork(trace(), 'start', 'end');
    expect([work.pid, work.tid, work.windowMs]).toEqual([PID, MAIN, 64]);
    expect(work.frames.map((f) => [f.at, f.ms, f.workMs, f.active])).toEqual([
      [0, 16, 3, true],
      [16, 16, 0, false],
      [32, 16, 2, true],
      [48, 16, 2, false],
    ]);
    expect(work.all).toMatchObject({ n: 4, p95: 3, max: 3 });
    expect(work.active).toMatchObject({ n: 2, p50: 2, p95: 3 });
    expect(work.inputs).toBe(1);
    expect(work.compositor).toBeNull(); // no reporter in the trace: not "no drops"
  });

  it('falls back to the thread controller’s task slices when the trace has no RunTask', () => {
    const events = trace().map((e) => (e.name === 'RunTask' ? { ...e, name: 'ThreadControllerImpl::RunTask' } : e));
    expect(frameWork(events, 'start', 'end').frames.map((f) => f.workMs)).toEqual([3, 0, 2, 2]);
  });

  it('reports the compositor’s frames and its dropped ones when its reporter is traced', () => {
    const work = frameWork(trace([reporter(0, 'STATE_PRESENTED_ALL'), reporter(16_000, 'STATE_DROPPED'), reporter(32_000, 'STATE_PRESENTED_ALL'), reporter(80_000, 'STATE_DROPPED')]), 'start', 'end');
    expect(work.compositor).toEqual({ frames: 3, dropped: 1, droppedFrameEvents: 0 });
  });

  it('refuses a trace it cannot read rather than answering a number', () => {
    expect(() => frameWork(trace().filter((e) => e.name !== 'end'), 'start', 'end')).toThrow(/no end mark/);
    expect(() => frameWork(trace().filter((e) => e.name !== 'BeginFrame'), 'start', 'end')).toThrow(/0 BeginFrame/);
    expect(() => frameWork(trace().filter((e) => e.name !== 'RunTask'), 'start', 'end')).toThrow(/no top-level task/);
    expect(() => frameWork([...trace().filter((e) => e.name !== 'end'), mark('end', 64_000, 5)], 'start', 'end')).toThrow(/two threads/);
  });
});

describe('the rAF-gap proxy', () => {
  const idle = Array.from({ length: 31 }, (_, k) => k * 16.7);
  it('counts each skipped frame against the calibrated interval over the span’s frames', () => {
    const stamps = [0, 16.7, 33.4, 83.5, 100.2, 116.9, 133.6]; // one gap of three intervals: two frames skipped
    const drops = rafDrops(idle, stamps);
    expect(drops.intervalMs).toBeCloseTo(16.7, 5);
    expect(drops.expected).toBe(8);
    expect(drops.dropped).toBe(2);
    expect(drops.share).toBeCloseTo(0.25, 5);
    expect(drops.longestGapMs).toBeCloseTo(50.1, 5);
  });
  it('counts no drop for jitter under one and a half intervals, and refuses an uncalibrated run', () => {
    expect(rafDrops(idle, [0, 16.7, 40, 56.7]).dropped).toBe(0);
    expect(() => rafDrops(idle.slice(0, 5), [0, 16.7])).toThrow(/calibration/);
  });
});

describe('distribution', () => {
  it('reads nearest-rank percentiles', () => {
    const d = distribution(Array.from({ length: 100 }, (_, k) => k + 1));
    expect([d.n, d.p50, d.p95, d.max, d.mean]).toEqual([100, 50, 95, 100, 50.5]);
    expect(distribution([]).n).toBe(0);
  });
});

describe('the publications inside a measured window', () => {
  it('counts only those asked at or after its start and answered by its end, with their request intervals', () => {
    const pubs = [
      { requestedAt: 900, answeredAt: 950 }, // during calibration: before the window
      { requestedAt: 1_000, answeredAt: 1_040 }, // at its start
      { requestedAt: 1_700, answeredAt: 1_760 },
      { requestedAt: 2_400, answeredAt: 2_430 },
      { requestedAt: 3_100, answeredAt: 3_200 }, // asked inside, answered after its end
    ];
    expect(inside(pubs, { startedAt: 1_000, endedAt: 3_150 })).toEqual({ indexes: [1, 2, 3], count: 3, intervalsMs: [700, 700] });
    expect(inside(pubs, { startedAt: 3_300, endedAt: 4_000 })).toEqual({ indexes: [], count: 0, intervalsMs: [] });
  });
});
