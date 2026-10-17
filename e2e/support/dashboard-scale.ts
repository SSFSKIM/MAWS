// The dashboard scale gate's judging (P3-E2 M6 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md, "Acceptance seam
// and measurement definitions"; parent Decision Log 42; E2's execution Decision Log 36), free of Playwright so
// test/support/dashboard-scale.test.ts runs it under vitest:
// - a timing row (bind, open, render, replace) needs three admitted trials, a trial admitted only when it started at a
//   1-minute load below 10, and every admitted trial within the bound; fewer than three admitted is hardware-blocked,
//   never met; the median and the best are description only;
// - the scroll row is the p95 of every admitted trial's events pooled, each trial's own p95 information only; any long
//   task over 50 ms during a scroll fails it by itself, whatever the load;
// - the renderer's memory is its own documented `process.getProcessMemoryInfo().private` (src/preload/process-memory.ts),
//   sampled every 10 s: any sample started at load 10 or more blocks the row; the later of the first two consecutive
//   samples within 5 %, both completed within 60 s of the first one's start, is gated; never a forced collection's.

export const LOAD_BELOW = 10;
export const LONG_TASK_MS = 50;
export const REQUIRED_TRIALS = 3;

export type Verdict = 'met' | 'failed' | 'recorded' | 'hardware-blocked' | 'unsettled';

/** The value at rank `p` (0..1] of `values`, by rank (NaN when there is none). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

const admitted = <T extends { load: number }>(trials: readonly T[]): T[] => trials.filter((t) => t.load < LOAD_BELOW);

/** A timing row's verdict over its trials (`limit` null: recorded with no bound). */
export function timingVerdict(trials: readonly { value: number; load: number }[], limit: number | null, required = REQUIRED_TRIALS): { verdict: Verdict; admitted: number; reason?: string } {
  const counted = admitted(trials);
  if (limit === null) return { verdict: 'recorded', admitted: counted.length };
  const over = counted.filter((t) => !(t.value <= limit));
  if (over.length > 0) return { verdict: 'failed', admitted: counted.length, reason: `${over.map((t) => `${+t.value.toFixed(2)} at load ${t.load}`).join(', ')} over ${limit}` };
  if (counted.length < required) return { verdict: 'hardware-blocked', admitted: counted.length, reason: `${counted.length} of ${required} trials started below load ${LOAD_BELOW}` };
  return { verdict: 'met', admitted: counted.length };
}

/** The scroll row: the pooled p95 of the admitted trials' per-event work, every trial's long tasks. */
export function scrollVerdict(trials: readonly { work: readonly number[]; load: number; longTasks: readonly number[] }[], limit: number, required = REQUIRED_TRIALS): { verdict: Verdict; pooledP95: number; perTrialP95: number[]; events: number; reason?: string } {
  const counted = admitted(trials);
  const pooled = counted.flatMap((t) => t.work);
  const pooledP95 = percentile(pooled, 0.95);
  const perTrialP95 = trials.map((t) => percentile(t.work, 0.95));
  const long = trials.flatMap((t) => t.longTasks).filter((ms) => ms > LONG_TASK_MS);
  const base = { pooledP95, perTrialP95, events: pooled.length };
  if (long.length > 0) return { ...base, verdict: 'failed', reason: `a long task over ${LONG_TASK_MS} ms during a scroll: ${long.map((ms) => ms.toFixed(1)).join(', ')} ms` };
  if (counted.length < required) return { ...base, verdict: 'hardware-blocked', reason: `${counted.length} of ${required} trials started below load ${LOAD_BELOW}` };
  if (pooled.length === 0) return { ...base, verdict: 'failed', reason: 'no scroll event reached a rows commit' };
  if (!(pooledP95 <= limit)) return { ...base, verdict: 'failed', reason: `pooled p95 ${pooledP95.toFixed(2)} ms over ${limit} ms` };
  return { ...base, verdict: 'met' };
}

/**
 * The replacement row's interval: from the first observed post-write revision announcement (the seam's `announcedAt`,
 * host clock) to the last view painted (the page's clock, the same machine's); an absent announcement or a paint before
 * it fails by name, never clamped and never replaced by the tool's answer time.
 */
export function replacementInterval(announcedAt: number | undefined, paintedAt: number): { ok: true; value: number } | { ok: false; reason: string } {
  if (announcedAt === undefined) return { ok: false, reason: 'no post-write revision announcement was observed for the replacement' };
  const value = paintedAt - announcedAt;
  if (value < 0) return { ok: false, reason: `the last view painted ${-value} ms before the post-write revision announcement` };
  return { ok: true, value };
}

/** The renderer's private memory in MB from its `process.getProcessMemoryInfo()` answer (KB); refused unless finite and non-negative. */
export function privateMB(info: unknown): number {
  const kb = (info as { private?: unknown } | null | undefined)?.private;
  if (typeof kb !== 'number' || !Number.isFinite(kb) || kb < 0) throw new Error(`the renderer's process memory has no usable private value: ${JSON.stringify(info)}`);
  return kb / 1024;
}

export const MEMORY_DEADLINE_MS = 60_000;
export const MEMORY_SPACING_MS = 10_000;

/**
 * The memory row (parent Decision Log 42(5)) over samples taken 10 s apart, each with its start and completion (ms from
 * the first sample's start), its start load and the renderer's private MB: hardware-blocked by any sample started at
 * load 10 or more, whatever came after; else the later of the first two consecutive samples within `tolerance`, both
 * completed within the deadline, gated at `limit`; no such pair is unsettled.
 */
export function memoryVerdict(samples: readonly { startedAt: number; completedAt: number; load: number; mb: number }[], limit: number, tolerance = 0.05, deadline = MEMORY_DEADLINE_MS): { verdict: Verdict; value: number | null; reason?: string } {
  const loaded = samples.filter((s) => s.load >= LOAD_BELOW);
  if (loaded.length > 0) return { verdict: 'hardware-blocked', value: null, reason: `${loaded.length} sample(s) started at load ${LOAD_BELOW} or more (${loaded.map((s) => s.load).join(', ')})` };
  const t0 = samples[0]?.startedAt ?? 0;
  const timely = samples.filter((s) => s.completedAt - t0 <= deadline);
  for (let i = 1; i < timely.length; i++) {
    const [a, b] = [timely[i - 1]!.mb, timely[i]!.mb];
    if (Math.abs(b - a) <= tolerance * Math.max(a, b)) return b <= limit ? { verdict: 'met', value: b } : { verdict: 'failed', value: b, reason: `settled at ${b.toFixed(1)} MB over ${limit} MB` };
  }
  return { verdict: 'unsettled', value: null, reason: `no two consecutive samples within 5 % completed within ${deadline / 1000} s of the first: ${samples.map((s) => `${s.mb.toFixed(1)} MB at ${(s.completedAt / 1000).toFixed(1)} s`).join(', ')}` };
}
