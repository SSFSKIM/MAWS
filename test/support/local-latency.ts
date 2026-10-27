// The local-latency bench's numbers (P5 O1, M1; P5 §10 and OX7): the statistics, the run's validity, the baseline and
// the budget. OX7's delta-to-paint is measured as delta to frame (P5 Decision Log 20): from the stub engine's write of a
// text delta to the end of the main-thread work of the frame that renders it. The bench itself is
// e2e/local-latency.spec.ts, whose engine is test/support/latency-engine-stub.mjs.
//
// The baseline is the app at c3507722d (O1's base, whose src/ M1's commit keeps): three runs of `e2e:local-latency` at
// M1's commit on the mini, each metric's median p50 and p95 across them, with the runs' spread. Until it is recorded the
// spec asserts only that a run is valid; once it is, each landing step is held to it plus OX7_BUDGET_MS.

export interface LatencySummary {
  p50: number;
  p95: number;
  n: number;
}

export const OX7_BUDGET_MS = { p50: 2, p95: 5 } as const;

export const LOCAL_LATENCY_BASELINE: null | {
  commit: string;
  appTree: 'c3507722d';
  runs: string[];
  deltaToFrame: LatencySummary & { spreadP50: number; spreadP95: number };
  roundTrip: LatencySummary & { spreadP50: number; spreadP95: number };
} = null;

// The run's shape: three turns of 300 deltas, the first a warm-up; 220 round trips, the first 20 a warm-up. A run with
// fewer than 95% of the kept markers as samples is invalid, as is a renderer clock more than 1 ms off the runner's.
export const BENCH = { turns: 3, warmupTurns: 1, markersPerTurn: 300, roundTrips: 220, roundTripWarmup: 20, sampleFloor: 0.95, clockToleranceMs: 1 } as const;

// The p-th percentile by nearest rank over ascending samples: the ⌈p/100 · n⌉-th smallest.
export function nearestRank(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

// p50 and p95 of the samples after the first `warmup`. A negative sample means the clocks disagree, so it is refused.
export function summarize(samples: number[], warmup: number): LatencySummary {
  const kept = samples.slice(warmup);
  if (kept.length === 0) throw new Error(`no samples after the ${warmup} warm-up samples`);
  const negative = kept.filter((sample) => sample < 0).length;
  if (negative > 0) throw new Error(`${negative} negative sample${negative === 1 ? '' : 's'}: the clocks disagree`);
  const sorted = [...kept].sort((a, b) => a - b);
  return { p50: nearestRank(sorted, 50), p95: nearestRank(sorted, 95), n: kept.length };
}

// One bracket: a runner clock read, the renderer's, the runner's again, each `performance.timeOrigin + performance.now()`.
export interface ClockBracket {
  before: number;
  renderer: number;
  after: number;
}
export interface ClockCheck {
  ok: boolean;
  widthMs: number; // the tightest bracket's width
  offsetMs: number; // the renderer's read less the tightest bracket's midpoint
}

// The tightest bracket places the renderer's clock: within the bracket widened by the tolerance on each side.
export function clockCheck(brackets: readonly ClockBracket[]): ClockCheck {
  const tightest = [...brackets].sort((a, b) => a.after - a.before - (b.after - b.before))[0]!;
  const ok = tightest.renderer >= tightest.before - BENCH.clockToleranceMs && tightest.renderer <= tightest.after + BENCH.clockToleranceMs;
  return { ok, widthMs: tightest.after - tightest.before, offsetMs: tightest.renderer - (tightest.before + tightest.after) / 2 };
}

const ms = (value: number) => Number(value.toFixed(1));

// Why a run is invalid, each reason one line; empty when it is valid. `samples` are the kept markers' delays.
export function invalidReasons(run: { samples: readonly number[]; expected: number; missing: readonly { turn: number; markers: readonly string[] }[]; clock: ClockCheck }): string[] {
  const reasons: string[] = [];
  const floor = Math.ceil(run.expected * BENCH.sampleFloor);
  if (run.samples.length < floor) reasons.push(`${run.samples.length} samples of ${run.expected}, under the floor of ${floor} (${BENCH.sampleFloor * 100}%)`);
  for (const { turn, markers } of run.missing) reasons.push(`turn ${turn} lacks ${markers.length} of its markers after it completed (${markers.slice(0, 5).join(', ')}${markers.length > 5 ? ', …' : ''})`);
  if (!run.clock.ok) reasons.push(`the renderer's clock is ${ms(Math.abs(run.clock.offsetMs))} ms off the runner's (tightest bracket ${ms(run.clock.widthMs)} ms; the check allows ±${BENCH.clockToleranceMs} ms)`);
  const negative = run.samples.filter((sample) => sample < 0).length;
  if (negative > 0) reasons.push(`${negative} negative sample${negative === 1 ? '' : 's'}`);
  return reasons;
}

export interface BenchResult {
  deltaToFrame: LatencySummary;
  roundTrip: LatencySummary;
}

// OX7: each metric's p50 within the baseline's plus 2 ms, its p95 within the baseline's plus 5 ms. Nothing is asserted
// before the baseline is recorded.
export function budgetMisses(result: BenchResult, baseline = LOCAL_LATENCY_BASELINE, budget: { p50: number; p95: number } = OX7_BUDGET_MS): string[] {
  if (baseline === null) return [];
  const misses: string[] = [];
  for (const [label, metric] of [['delta-to-frame', 'deltaToFrame'], ['round trip', 'roundTrip']] as const) {
    for (const p of ['p50', 'p95'] as const) {
      const measured = result[metric][p];
      if (measured > baseline[metric][p] + budget[p]) misses.push(`${label} ${p} ${measured} ms over the baseline ${baseline[metric][p]} ms + ${budget[p]} ms`);
    }
  }
  return misses;
}

// The job log's line (acceptance 1).
export function latencyLine(run: BenchResult & { expected: number; load: number }): string {
  const f = (value: number) => value.toFixed(1);
  const { deltaToFrame: d, roundTrip: r } = run;
  return `[local-latency] delta-to-frame p50 ${f(d.p50)} ms p95 ${f(d.p95)} ms (n=${d.n} of ${run.expected}) · round trip p50 ${f(r.p50)} ms p95 ${f(r.p95)} ms (n=${r.n}) · load ${f(run.load)}`;
}
