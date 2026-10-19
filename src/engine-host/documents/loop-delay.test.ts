// P3-F L158: the engine host's run-wide loop-delay sampler behind A's `artifacts.testLoopDelay`. Its own interval timer
// at A's 10 ms cadence records each whole gap between two of its ticks, so a block shows in the gap it stretches
// wherever it starts (the M9 review saw `monitorEventLoopDelay` read an 80 ms block as 1.3 ms in Electron's utility
// process; that miss is Electron's and is not reproduced here: these cases pin the sampler's own reading, and the
// native proof is document-scale's row 5).
import { afterEach, describe, expect, it } from 'vitest';
import { LOOP_DELAY_TICK_MS, LoopDelaySampler, type LoopDelayClock } from './loop-delay';

/** A clock the test moves by hand: `tick(ms)` advances time by `ms` and then runs the interval's callback. */
function manualClock(): LoopDelayClock & { tick(ms: number): void; started: number[]; unrefs: number; cleared: number } {
  let now = 1_000;
  let callback: (() => void) | null = null;
  const clock = {
    started: [] as number[],
    unrefs: 0,
    cleared: 0,
    now: () => now,
    every(ms: number, fn: () => void) {
      clock.started.push(ms);
      callback = fn;
      return {
        unref: () => void (clock.unrefs += 1),
        close: () => {
          clock.cleared += 1;
          callback = null;
        },
      };
    },
    tick(ms: number) {
      now += ms;
      callback?.();
    },
  };
  return clock;
}

let sampler: LoopDelaySampler | null = null;
afterEach(() => {
  sampler?.close();
  sampler = null;
});

describe('the host loop-delay sampler (P3-F L158)', () => {
  it('starts its own unref’d 10 ms timer at the first read, which answers zeros, and none before', () => {
    const clock = manualClock();
    sampler = new LoopDelaySampler(clock);
    expect(clock.started).toEqual([]);
    expect(sampler.read({})).toEqual({ p50: 0, p99: 0, max: 0, mean: 0 });
    expect(clock.started).toEqual([LOOP_DELAY_TICK_MS]);
    expect(clock.unrefs).toBe(1);
    sampler.read({});
    expect(clock.started).toHaveLength(1); // one timer for the run
  });

  it('records each whole gap between its ticks, a block included in full wherever in the gap it starts, read in ms', () => {
    const clock = manualClock();
    sampler = new LoopDelaySampler(clock);
    sampler.read({ reset: true });
    for (let k = 0; k < 98; k++) clock.tick(10);
    clock.tick(10.4);
    // a block that starts right after the sampler's own tick holds the loop 80 ms: the next tick comes 80 ms late
    clock.tick(90);
    const answer = sampler.read({});
    expect(answer.max).toBeCloseTo(90, 1);
    expect(answer.p50).toBeCloseTo(10, 1);
    expect(answer.p99).toBeGreaterThanOrEqual(10);
    expect(answer.mean).toBeCloseTo((98 * 10 + 10.4 + 90) / 100, 1);
  });

  it('a reset empties the histogram and restarts the gap from the reset, so time before it is not counted', () => {
    const clock = manualClock();
    sampler = new LoopDelaySampler(clock);
    sampler.read({});
    clock.tick(10);
    clock.tick(200);
    expect(sampler.read({ reset: true }).max).toBeCloseTo(200, 1);
    expect(sampler.read({})).toEqual({ p50: 0, p99: 0, max: 0, mean: 0 });
    clock.tick(10);
    clock.tick(12);
    expect(sampler.read({}).max).toBeCloseTo(12, 1);
  });

  it('records a gap under a nanosecond as one nanosecond (the histogram takes positive integers)', () => {
    const clock = manualClock();
    sampler = new LoopDelaySampler(clock);
    sampler.read({});
    clock.tick(0);
    expect(sampler.read({}).max).toBeCloseTo(0, 5);
  });

  it('close stops the timer', () => {
    const clock = manualClock();
    sampler = new LoopDelaySampler(clock);
    sampler.close(); // never started: nothing to stop
    expect(clock.cleared).toBe(0);
    sampler.read({});
    sampler.close();
    expect(clock.cleared).toBe(1);
  });

  it('on the real clock, an 80 ms synchronous block reads at least 80 ms', async () => {
    sampler = new LoopDelaySampler();
    sampler.read({ reset: true });
    await new Promise((resolve) => setTimeout(resolve, 3 * LOOP_DELAY_TICK_MS));
    const until = performance.now() + 80;
    while (performance.now() < until) {
      // the block
    }
    await new Promise((resolve) => setTimeout(resolve, 3 * LOOP_DELAY_TICK_MS));
    expect(sampler.read({}).max).toBeGreaterThanOrEqual(80);
  });
});
