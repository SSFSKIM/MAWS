// The engine host's run-wide loop-delay sampler behind A's `artifacts.testLoopDelay` (Decision Log 23h; P3-F L158). Its
// own interval timer, at A's 10 ms cadence, records each whole gap between two of its ticks: a block stretches the gap
// it falls in, wherever in the gap it starts, so it is read in full. `monitorEventLoopDelay` was the sampler before; in
// Electron's utility process the M9 review saw it read an 80 ms synchronous call as 1.3 ms (a block in the same pass of
// the loop as its own sampling timer), and event-loop utilization reads 0 there, so neither is used. The timer starts
// at the first read (an e2e host that never measures runs none) and is unref'd; the gaps go into a recordable
// histogram (positive integer nanoseconds, bounded memory over a whole run) and are answered in ms.
import { createHistogram, performance } from 'node:perf_hooks';

export const LOOP_DELAY_TICK_MS = 10;

export interface LoopDelay {
  p50: number;
  p99: number;
  max: number;
  mean: number;
}

/** The clock and interval timer the sampler runs on; the real ones by default. */
export interface LoopDelayClock {
  now(): number;
  every(ms: number, tick: () => void): { unref(): void; close(): void };
}

const realClock: LoopDelayClock = {
  now: () => performance.now(),
  every: (ms, tick) => {
    const timer = setInterval(tick, ms);
    return { unref: () => void timer.unref(), close: () => clearInterval(timer) };
  },
};

const EMPTY: LoopDelay = { p50: 0, p99: 0, max: 0, mean: 0 };

export class LoopDelaySampler {
  private readonly histogram = createHistogram();
  private timer: { close(): void } | null = null;
  private last = 0;

  constructor(private readonly clock: LoopDelayClock = realClock) {}

  /** The gaps since the last reset in ms (zeros when none was recorded, as at the first read, which starts the timer); `reset` empties them after the answer. */
  read({ reset = false }: { reset?: boolean }): LoopDelay {
    if (!this.timer) this.start();
    const h = this.histogram;
    const ms = (ns: number) => ns / 1e6;
    const answer = h.count === 0 ? EMPTY : { p50: ms(h.percentile(50)), p99: ms(h.percentile(99)), max: ms(h.max), mean: ms(h.mean) };
    if (reset) {
      h.reset();
      this.last = this.clock.now();
    }
    return answer;
  }

  close(): void {
    this.timer?.close();
    this.timer = null;
  }

  private start(): void {
    this.last = this.clock.now();
    const timer = this.clock.every(LOOP_DELAY_TICK_MS, () => {
      const now = this.clock.now();
      this.histogram.record(Math.max(1, Math.round((now - this.last) * 1e6)));
      this.last = now;
    });
    timer.unref();
    this.timer = timer;
  }
}
