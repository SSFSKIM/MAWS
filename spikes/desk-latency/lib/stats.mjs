// Percentiles as the desk's instrument takes them (nearest rank, apps/desk-web/src/latency/latency.ts), so a figure here
// and one from `window.deskLatency()` mean the same thing.
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** n, p50, p95 and max of the finite values in `values`, in ms rounded to 0.1; `low` when n is under 20, where p95 is
 * within a sample or two of the max and says little more than it. */
export function describe(values) {
  const sorted = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  const r = (v) => (v === null ? null : Math.round(v * 10) / 10);
  return { n: sorted.length, p50: r(percentile(sorted, 50)), p95: r(percentile(sorted, 95)), max: r(sorted.length ? sorted[sorted.length - 1] : null), low: sorted.length < 20 };
}

export function median(values) {
  return describe(values).p50;
}
