// P3-E1 M6 (e2e/support/design-frames.ts): the design scale gate's frame readings on tiny synthetic traces. A frame's work
// is the renderer main thread's tasks that start in it, each read whole (nested and overlapping tasks counted once, never
// clipped at the frame's end), not the frame's length; idle frames are kept but the bound reads the active ones; the
// compositor's drops are reported only when the trace carries its reporter; the rAF proxy counts skipped frames against a
// calibrated interval.
import { describe, expect, it } from 'vitest';
import { distribution, frameWork, inside, rafDrops, relayoutCallback, type TraceEvent } from '../../e2e/support/design-frames';

const PID = 7;
const MAIN = 1;
const COMPOSITOR = 2;
const mark = (name: string, ts: number, tid = MAIN): TraceEvent => ({ name, cat: 'blink.user_timing', ph: 'R', ts, pid: PID, tid });
const begin = (ts: number, pid = PID): TraceEvent => ({ name: 'BeginFrame', cat: 'disabled-by-default-devtools.timeline.frame', ph: 'I', ts, pid, tid: COMPOSITOR });
const task = (ts: number, dur: number, name = 'RunTask', tid = MAIN, pid = PID): TraceEvent => ({ name, cat: 'disabled-by-default-devtools.timeline', ph: 'X', ts, dur, pid, tid });
const slice = (name: string, ts: number, dur: number, type?: string): TraceEvent => ({ name, cat: 'devtools.timeline', ph: 'X', ts, dur, pid: PID, tid: MAIN, ...(type && { args: { data: { type } } }) });
const reporter = (ts: number, state: string): TraceEvent => ({ name: 'PipelineReporter', cat: 'benchmark', ph: 'b', ts, pid: PID, tid: COMPOSITOR, args: { chrome_frame_reporter: { state } } });

/** Four 16 ms frames from t=0: a wheel frame with 3 ms of work (a nested RunTask inside), an idle one, a painting one whose
 * 4 ms task runs 2 ms past its end, and a frame where another renderer and another thread were busy. */
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
    task(46_000, 4_000), // starts in frame 3 and runs 2 ms into frame 4: all 4 ms are frame 3's
    slice('Paint', 46_500, 1_000),
    task(50_000, 5_000, 'RunTask', 9), // another thread: not the main thread's work
    task(50_000, 5_000, 'RunTask', MAIN, 99), // another renderer
    begin(56_000, 99),
    mark('end', 64_000),
    ...extra,
  ];
}

describe('the frame work in a marked window', () => {
  it('reads each frame’s main-thread tasks whole in the frame they start in, nested tasks once, never clipped at its end', () => {
    const work = frameWork(trace(), 'start', 'end');
    expect([work.pid, work.tid, work.windowMs]).toEqual([PID, MAIN, 64]);
    expect(work.frames.map((f) => [f.at, f.ms, f.workMs, f.active])).toEqual([
      [0, 16, 3, true],
      [16, 16, 0, false],
      [32, 16, 4, true],
      [48, 16, 0, false],
    ]);
    expect(work.all).toMatchObject({ n: 4, p95: 4, max: 4 });
    expect(work.active).toMatchObject({ n: 2, p50: 3, p95: 4 });
    expect(work.inputs).toBe(1);
    expect(work.compositor).toBeNull(); // no reporter in the trace: not "no drops"
  });

  it('falls back to the thread controller’s task slices when the trace has no RunTask', () => {
    const events = trace().map((e) => (e.name === 'RunTask' ? { ...e, name: 'ThreadControllerImpl::RunTask' } : e));
    expect(frameWork(events, 'start', 'end').frames.map((f) => f.workMs)).toEqual([3, 0, 4, 0]);
  });

  // the defect the whole-task reading closes: a frame's slice could never exceed the frame, so on a display whose frame
  // is at most the 10 ms bound a long task read under it
  it.each([
    ['60', 16_667],
    ['99', 10_101],
    ['100', 10_000],
    ['120', 8_333],
  ])('reads a 12 ms wheel task as 12 ms of one active frame on a %s Hz display, the frames it overruns idle', (_, every) => {
    const events = [mark('start', 0), ...Array.from({ length: 6 }, (_, k) => begin(k * every)), task(1_000, 12_000), slice('EventDispatch', 1_100, 11_000, 'wheel'), mark('end', 5 * every)];
    const work = frameWork(events, 'start', 'end');
    expect(work.frames.map((f) => [f.workMs, f.active])).toEqual([[12, true], [0, false], [0, false], [0, false], [0, false]]);
    expect(work.active).toMatchObject({ n: 1, p95: 12, max: 12 });
  });

  it('makes the frame a long task starts in active by what the task did, wherever in the task it did it', () => {
    // a 40 ms task whose only frame production (its paint) lies two frames after the one it starts in
    const events = [mark('start', 0), begin(0), begin(16_000), begin(32_000), begin(48_000), task(2_000, 40_000), slice('Paint', 39_000, 2_000), mark('end', 48_000)];
    expect(frameWork(events, 'start', 'end').frames.map((f) => [f.workMs, f.active])).toEqual([[40, true], [0, false], [0, false]]);
  });

  it('reads a task’s activity over its whole length, past the end mark', () => {
    // 8 ms frames; a 20 ms task at 9–29 ms whose only paint (26–27 ms) lies after the end mark at 25 ms
    const events = [
      mark('start', 0),
      begin(0),
      begin(8_000),
      begin(16_000),
      begin(24_000),
      task(1_000, 1_000),
      slice('EventDispatch', 1_100, 500, 'wheel'),
      task(9_000, 20_000),
      slice('Paint', 26_000, 1_000),
      mark('end', 25_000),
    ];
    const work = frameWork(events, 'start', 'end');
    expect(work.frames.map((f) => [f.workMs, f.active])).toEqual([[1, true], [20, true], [0, false]]);
    expect(work.active).toMatchObject({ n: 2, p95: 20, max: 20 });
  });

  it('reads a task’s activity over its whole length, before the start mark', () => {
    // a task begun at 1 ms, before the start mark at 5 ms, running into the first frame; its only wheel dispatch ends before the mark
    const events = [mark('start', 5_000), task(1_000, 10_000), slice('EventDispatch', 2_000, 1_000, 'wheel'), begin(6_000), begin(14_000), begin(22_000), mark('end', 22_000)];
    const work = frameWork(events, 'start', 'end');
    expect(work.frames.map((f) => [f.workMs, f.active])).toEqual([[10, true], [0, false]]);
    expect(work.inputs).toBe(0); // inputs stay those dispatched in the window
  });

  it('keeps a task that begins the instant the previous one ends apart from it', () => {
    const events = [mark('start', 0), begin(0), begin(16_000), begin(32_000), task(10_000, 6_000), slice('Paint', 10_500, 500), task(16_000, 3_000), slice('Paint', 16_500, 500), mark('end', 32_000)];
    expect(frameWork(events, 'start', 'end').frames.map((f) => [f.workMs, f.active])).toEqual([[6, true], [3, true]]);
  });

  it('gives a task begun before the first frame and running into it to that frame, and none to a task outside the frames', () => {
    const events = [
      mark('start', 0),
      task(200, 1_000), // ends before the first frame begins
      task(1_500, 3_000), // begins before the first frame, runs into it
      slice('EventDispatch', 1_600, 2_000, 'wheel'),
      begin(2_000),
      begin(18_000),
      begin(34_000),
      task(35_000, 1_000), // after the last frame's start: no frame of the window holds it
      slice('Paint', 35_100, 500),
      mark('end', 40_000),
    ];
    expect(frameWork(events, 'start', 'end').frames.map((f) => [f.at, f.workMs, f.active])).toEqual([
      [2, 3, true],
      [18, 0, false],
    ]);
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

// DL39: the re-layout row reads the one animation-frame callback that ran every board's fresh layout pass after the
// requested scope stood, its whole wall time (the measure and write phases before the first board's listener included)
describe('the re-layout callback', () => {
  const BOARDS = ['b1', 'b2', 'b3'];
  const M = 'design-relayout-1';
  const um = (name: string, ts: number, tid = MAIN): TraceEvent => ({ name, cat: 'blink.user_timing', ph: 'I', ts, pid: PID, tid });
  const fire = (ts: number, dur: number, tdur?: number): TraceEvent => ({ name: 'FireAnimationFrame', cat: 'devtools.timeline', ph: 'X', ts, dur, pid: PID, tid: MAIN, ...(tdur !== undefined && { tdur }), args: { data: { id: ts } } });
  const layout = (board: string, ts: number, n = 1, mark = M) => um(`${mark}:layout:${board}:${n}`, ts);
  /** Enter at 1 ms, the scope standing at 2 ms, the pass's callback 16–40 ms holding the three boards' layouts at 30–39 ms, its frame's style and paint after it. */
  function relayTrace(extra: TraceEvent[] = [], without: (e: TraceEvent) => boolean = () => false): TraceEvent[] {
    return [
      um(`${M}:enter`, 1_000),
      um(`${M}:scope`, 2_000),
      layout('b1', 1_500, 1), // a layout before the scope stood: not the measured pass
      fire(1_200, 600), // the callback that ran it
      begin(16_000),
      fire(16_000, 24_000, 20_000),
      layout('b1', 30_000, 2),
      layout('b2', 35_000),
      layout('b3', 39_000),
      slice('UpdateLayoutTree', 40_500, 1_000),
      slice('Paint', 42_000, 2_000),
      begin(48_000),
      slice('Paint', 49_000, 5_000), // the next frame's: not this pass's
      ...extra,
    ].filter((e) => !without(e));
  }

  it('measures the whole callback holding every board’s first layout after the scope stood, with its CPU time and the frame’s work after it', () => {
    const r = relayoutCallback(relayTrace(), M, BOARDS);
    expect(r).toMatchObject({ wallMs: 24, cpuMs: 20, beforeFirstMarkMs: 14, marksSpanMs: 9, enterToScopeMs: 1, scopeToCallbackMs: 14, followingMs: 3 });
  });

  it('answers no CPU time when the trace has none', () => {
    const events = relayTrace().map((e) => (e.name === 'FireAnimationFrame' ? { ...e, tdur: undefined } : e));
    expect(relayoutCallback(events, M, BOARDS).cpuMs).toBeNull();
  });

  it('ignores another run’s marks', () => {
    expect(relayoutCallback(relayTrace([layout('b2', 31_000, 1, 'design-relayout-2'), um('design-relayout-2:scope', 25_000)]), M, BOARDS).wallMs).toBe(24);
  });

  it('refuses a missing board, a missing or repeated scope or enter mark, rather than answer a shorter slice', () => {
    expect(() => relayoutCallback(relayTrace([], (e) => e.name === `${M}:layout:b3:1`), M, BOARDS)).toThrow(/no layout after the scope stood: b3/);
    expect(() => relayoutCallback(relayTrace([], (e) => e.name === `${M}:scope`), M, BOARDS)).toThrow(/0 scope marks/);
    expect(() => relayoutCallback(relayTrace([um(`${M}:scope`, 3_000)]), M, BOARDS)).toThrow(/2 scope marks/);
    expect(() => relayoutCallback(relayTrace([], (e) => e.name === `${M}:enter`), M, BOARDS)).toThrow(/0 enter marks/);
    expect(() => relayoutCallback([um(`${M}:enter`, 5_000), ...relayTrace([], (e) => e.name === `${M}:enter`)], M, BOARDS)).toThrow(/the scope stood before the Enter/);
  });

  it('refuses layouts spread over two callbacks, or held by two', () => {
    const split = relayTrace([fire(36_000, 5_000)], (e) => e.name === 'FireAnimationFrame' && e.ts === 16_000);
    expect(() => relayoutCallback([...split, fire(16_000, 19_000)], M, BOARDS)).toThrow(/the layouts lie in 2 callbacks/);
    expect(() => relayoutCallback(relayTrace([fire(15_000, 26_000)]), M, BOARDS)).toThrow(/2 callbacks hold every layout/);
  });

  it('refuses a callback whose duration is not finite and positive, and a layout mark not at a finite time', () => {
    for (const dur of [Number.NaN, 0, -5]) {
      const events = relayTrace().map((e) => (e.name === 'FireAnimationFrame' && e.ts === 16_000 ? { ...e, dur } : e));
      expect(() => relayoutCallback(events, M, BOARDS), String(dur)).toThrow(/no callback holds every layout/);
    }
    const events = relayTrace().map((e) => (e.name === `${M}:layout:b2:1` ? { ...e, ts: Number.NaN } : e));
    expect(() => relayoutCallback(events, M, BOARDS)).toThrow(/not a finite time/);
  });
});
