// The margin's settle (P4-B1's follow-up wave; margin-settle.ts): an edit owes a pass rather than running one, the pass
// comes once the edits pause or at the ceiling, always through an idle moment, and any pass settles what is owed. Run
// on a clock of the test's own: timers fire as time is advanced, idle callbacks when the test gives an idle moment or
// at their timeout.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSettle, MARGIN_SETTLE_IDLE_MS, MARGIN_SETTLE_MAX_MS, MARGIN_SETTLE_QUIET_MS, pageClock, type Settle, type SettleClock } from './margin-settle';

class TestClock implements SettleClock {
  t = 0;
  private seq = 0;
  private timers: Array<{ id: number; at: number; run: () => void }> = [];
  private idles = new Map<number, { run: () => void; cancelTimeout: () => void }>();
  /** Idle requests made, with their timeouts. */
  readonly asked: number[] = [];
  now = () => this.t;
  later = (run: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + ms, run });
    return () => void (this.timers = this.timers.filter((timer) => timer.id !== id));
  };
  idle = (run: () => void, timeoutMs: number) => {
    const id = ++this.seq;
    this.asked.push(timeoutMs);
    this.idles.set(id, { run, cancelTimeout: this.later(() => this.runIdle(id), timeoutMs) });
    return () => {
      this.idles.get(id)?.cancelTimeout();
      this.idles.delete(id);
    };
  };
  private runIdle(id: number): void {
    const entry = this.idles.get(id);
    if (!entry) return;
    this.idles.delete(id);
    entry.cancelTimeout();
    entry.run();
  }
  /** An idle moment of the main thread: every idle callback asked for runs. */
  idleMoment(): void {
    for (const id of [...this.idles.keys()]) this.runIdle(id);
  }
  /** Time passes: each timer due runs at its own time, in order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const next = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.timers = this.timers.filter((timer) => timer !== next);
      this.t = next.at;
      next.run();
    }
    this.t = end;
  }
}

/** A settle whose run is the margin's pass as the margin makes it: it settles, and its time and wait are recorded. */
function settleOn(clock: TestClock, draws = true): { settle: Settle; runs: number[]; waits: Array<number | null> } {
  const runs: number[] = [];
  const waits: Array<number | null> = [];
  const settle: Settle = createSettle(() => {
    runs.push(clock.now());
    if (draws) waits.push(settle.settled());
  }, clock);
  return { settle, runs, waits };
}

describe('the margin’s settle', () => {
  it('owes a pass for an edit rather than running one, and runs it in an idle moment once the edits pause', () => {
    const clock = new TestClock();
    const { settle, runs, waits } = settleOn(clock);
    settle.changed();
    expect(runs).toEqual([]); // not in the edit's own task, nor its frame
    expect(settle.stale).toBe(true);
    clock.advance(MARGIN_SETTLE_QUIET_MS - 1);
    expect(clock.asked).toEqual([]);
    clock.advance(1); // the quiet: due, asked of an idle moment within the idle bound
    expect(clock.asked).toEqual([MARGIN_SETTLE_IDLE_MS]);
    expect(runs).toEqual([]);
    clock.advance(5);
    clock.idleMoment();
    expect(runs).toEqual([MARGIN_SETTLE_QUIET_MS + 5]);
    expect(waits).toEqual([MARGIN_SETTLE_QUIET_MS + 5]);
    expect(settle.stale).toBe(false);
    clock.advance(10_000);
    expect(runs).toHaveLength(1); // nothing more owed
  });

  it('counts the quiet from the last edit, and runs the pass by its idle bound when no idle moment comes', () => {
    const clock = new TestClock();
    const { settle, runs } = settleOn(clock);
    for (const at of [0, 100, 200]) {
      clock.advance(at - clock.t);
      settle.changed();
    }
    clock.advance(MARGIN_SETTLE_QUIET_MS - 1);
    expect(clock.asked).toEqual([]);
    clock.advance(1); // the last edit's quiet, before the ceiling's timer (900 ms after the first)
    expect(clock.asked).toEqual([MARGIN_SETTLE_IDLE_MS]);
    clock.advance(MARGIN_SETTLE_IDLE_MS); // no idle moment: the idle callback's timeout runs it
    expect(runs).toEqual([200 + MARGIN_SETTLE_QUIET_MS + MARGIN_SETTLE_IDLE_MS]);
  });

  it('never leaves an edit unread past the ceiling under edits that never pause', () => {
    const clock = new TestClock();
    const { settle, runs, waits } = settleOn(clock);
    // an edit every 60 ms for 20 s (a keystroke, an agent's batch, the layer's growth), no idle moment ever: the worst case
    for (let t = 0; t < 20_000; t += 60) {
      clock.advance(t - clock.t);
      settle.changed();
    }
    clock.advance(MARGIN_SETTLE_MAX_MS);
    expect(runs.length).toBeGreaterThanOrEqual(19);
    expect(Math.max(...waits.map((w) => w ?? 0))).toBeLessThanOrEqual(MARGIN_SETTLE_MAX_MS);
    // and with idle moments between the edits (one every frame), the pass comes at the ceiling's timer, one per ceiling
    const idle = new TestClock();
    const busy = settleOn(idle);
    for (let t = 0; t < 10_000; t += 16) {
      idle.advance(t - idle.t);
      if (t % 64 === 0) busy.settle.changed(); // an edit every fourth frame
      idle.idleMoment();
    }
    expect(Math.max(...busy.waits.map((w) => w ?? 0))).toBeLessThanOrEqual(MARGIN_SETTLE_MAX_MS - MARGIN_SETTLE_IDLE_MS + 16);
    expect(busy.runs.length).toBeLessThanOrEqual(Math.ceil(10_000 / (MARGIN_SETTLE_MAX_MS - MARGIN_SETTLE_IDLE_MS)));
  });

  it('a pass of any cause settles what the edits owed: the owed pass does not run after it', () => {
    const clock = new TestClock();
    const { settle, runs } = settleOn(clock);
    settle.changed();
    clock.advance(200);
    expect(settle.settled()).toBe(200); // an activation, a resize: its pass read every anchor
    expect(settle.stale).toBe(false);
    clock.advance(5_000);
    clock.idleMoment();
    expect(runs).toEqual([]);
    expect(settle.settled()).toBeNull(); // nothing owed
    // also once due, its idle callback already asked for
    settle.changed();
    clock.advance(MARGIN_SETTLE_QUIET_MS);
    expect(clock.asked).toHaveLength(1);
    settle.settled();
    clock.idleMoment();
    clock.advance(MARGIN_SETTLE_IDLE_MS);
    expect(runs).toEqual([]);
  });

  it('an edit while the pass is due is read by that pass, not a later one', () => {
    const clock = new TestClock();
    const { settle, runs, waits } = settleOn(clock);
    settle.changed();
    clock.advance(MARGIN_SETTLE_QUIET_MS);
    settle.changed(); // the pass asked of an idle moment already
    clock.advance(20);
    clock.idleMoment();
    expect(runs).toEqual([MARGIN_SETTLE_QUIET_MS + 20]);
    expect(waits).toEqual([MARGIN_SETTLE_QUIET_MS + 20]);
    clock.advance(5_000);
    expect(runs).toHaveLength(1);
  });

  it('owes nothing after a run that drew nothing (the margin off meanwhile), and nothing after dispose', () => {
    const clock = new TestClock();
    const { settle, runs } = settleOn(clock, false);
    settle.changed();
    clock.advance(MARGIN_SETTLE_QUIET_MS);
    clock.idleMoment();
    expect(runs).toHaveLength(1);
    expect(settle.stale).toBe(false);
    settle.changed();
    settle.dispose();
    clock.advance(5_000);
    clock.idleMoment();
    expect(runs).toHaveLength(1);
    expect(settle.stale).toBe(false);
  });
});

describe('the page’s clock', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the page for an idle callback with the idle bound as its timeout, and cancels it', () => {
    const request = vi.fn<(run: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void, options?: { timeout?: number }) => number>(() => 7);
    const cancel = vi.fn();
    vi.stubGlobal('requestIdleCallback', request);
    vi.stubGlobal('cancelIdleCallback', cancel);
    const run = vi.fn();
    const stop = pageClock.idle(run, MARGIN_SETTLE_IDLE_MS);
    expect(request).toHaveBeenCalledWith(expect.any(Function), { timeout: MARGIN_SETTLE_IDLE_MS });
    request.mock.calls[0]![0]({ didTimeout: false, timeRemaining: () => 10 });
    expect(run).toHaveBeenCalledTimes(1);
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });
});
