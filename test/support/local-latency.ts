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

export interface LocalLatencyBaseline {
  commit: string;
  appTree: 'c3507722d';
  runs: string[];
  deltaToFrame: LatencySummary & { spreadP50: number; spreadP95: number };
  roundTrip: LatencySummary & { spreadP50: number; spreadP95: number };
}
// Recorded 2026-10-27 from three valid runs at M1's commit 12bd0b3b2 on the mini (each 600 of 600 markers, 200 round
// trips): delta to frame p50 24.56 / 24.45 / 24.23 ms and p95 37.56 / 37.78 / 37.07 ms; round trip p50 0.9 / 0.9 /
// 0.9 ms and p95 1.2 / 1.3 / 1.3 ms. Each value is the median of the three, n the smallest run's.
export const LOCAL_LATENCY_BASELINE: LocalLatencyBaseline | null = {
  commit: '12bd0b3b2',
  appTree: 'c3507722d',
  runs: ['40440185564', '40440764482', '40441045572'],
  deltaToFrame: { p50: 24.45, p95: 37.56, n: 600, spreadP50: 0.33, spreadP95: 0.71 },
  roundTrip: { p50: 0.9, p95: 1.3, n: 200, spreadP50: 0, spreadP95: 0.1 },
};

// The run's shape: three turns of 300 deltas, the first a warm-up; 220 round trips, the first 20 a warm-up. A run with
// fewer than 95% of the kept markers as samples is invalid, as is a renderer clock more than 1 ms off the runner's.
export const BENCH = { turns: 3, warmupTurns: 1, markersPerTurn: 300, roundTrips: 220, roundTripWarmup: 20, sampleFloor: 0.95, clockToleranceMs: 1 } as const;

// What is wrong with a recorded baseline, each one line; empty when it is well formed, and for none recorded yet. It
// is three distinct valid runs at a commit, each metric's n a valid run's, ranked, with non-negative spreads.
export function baselineProblems(baseline: LocalLatencyBaseline | null): string[] {
  if (baseline === null) return [];
  const problems: string[] = [];
  if (!/^[0-9a-f]{7,40}$/.test(baseline.commit)) problems.push(`commit ${baseline.commit} is not a sha`);
  if (baseline.appTree !== 'c3507722d') problems.push(`appTree ${String(baseline.appTree)} is not c3507722d`);
  if (baseline.runs.length !== 3 || new Set(baseline.runs).size !== 3) problems.push(`runs [${baseline.runs.join(', ')}] are not three distinct run ids`);
  const floor = Math.ceil(BENCH.markersPerTurn * (BENCH.turns - BENCH.warmupTurns) * BENCH.sampleFloor);
  const trips = BENCH.roundTrips - BENCH.roundTripWarmup;
  for (const [label, metric, n] of [['delta-to-frame', baseline.deltaToFrame, null], ['round trip', baseline.roundTrip, trips]] as const) {
    if (n === null ? metric.n < floor : metric.n !== n) problems.push(`${label} n ${metric.n} ${n === null ? `is under the floor of ${floor}` : `is not ${n}`}`);
    if (metric.p50 < 0) problems.push(`${label} p50 ${metric.p50} is negative`);
    if (metric.p95 < metric.p50) problems.push(`${label} p95 ${metric.p95} is under its p50 ${metric.p50}`);
    for (const spread of ['spreadP50', 'spreadP95'] as const) if (metric[spread] < 0) problems.push(`${label} ${spread} ${metric[spread]} is negative`);
  }
  return problems;
}

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
  offsetRangeMs: [number, number]; // every offset the tightest bracket allows: [renderer − after, renderer − before]
}

// The tightest bracket places the renderer's clock: the renderer read at some runner time inside it, so its offset from
// the runner's clock is somewhere in [renderer − after, renderer − before]. The check passes only when that whole range
// lies within ±1 ms; a bracket too wide to say so (over 2 ms) fails as inconclusive.
export function clockCheck(brackets: readonly ClockBracket[]): ClockCheck {
  const tightest = [...brackets].sort((a, b) => a.after - a.before - (b.after - b.before))[0]!;
  const offsetRangeMs: [number, number] = [tightest.renderer - tightest.after, tightest.renderer - tightest.before];
  const ok = offsetRangeMs[0] >= -BENCH.clockToleranceMs && offsetRangeMs[1] <= BENCH.clockToleranceMs;
  return { ok, widthMs: tightest.after - tightest.before, offsetMs: tightest.renderer - (tightest.before + tightest.after) / 2, offsetRangeMs };
}

const ms = (value: number) => Number(value.toFixed(1));

// Why a run is invalid, each reason one line; empty when it is valid. `samples` are the kept markers' delays.
export function invalidReasons(run: { samples: readonly number[]; expected: number; missing: readonly { turn: number; markers: readonly string[] }[]; clock: ClockCheck }): string[] {
  const reasons: string[] = [];
  const floor = Math.ceil(run.expected * BENCH.sampleFloor);
  if (run.samples.length < floor) reasons.push(`${run.samples.length} samples of ${run.expected}, under the floor of ${floor} (${BENCH.sampleFloor * 100}%)`);
  for (const { turn, markers } of run.missing) reasons.push(`turn ${turn} lacks ${markers.length} of its markers after it completed (${markers.slice(0, 5).join(', ')}${markers.length > 5 ? ', …' : ''})`);
  if (!run.clock.ok) {
    const [low, high] = run.clock.offsetRangeMs.map(ms);
    reasons.push(`the renderer's clock is not shown within ±${BENCH.clockToleranceMs} ms of the runner's: its offset lies in [${low}, ${high}] ms (tightest bracket ${ms(run.clock.widthMs)} ms)`);
  }
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
