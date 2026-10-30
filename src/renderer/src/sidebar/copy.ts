// The sidebar's own words (P5 O2 M2: the Keep running action, docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M2
// "Keep"): a kept session is never stopped for being idle, though the memory budget may still release it.
export const KEEP_RUNNING = {
  keep: 'Keep running',
  stopKeeping: 'Stop keeping running',
} as const;
