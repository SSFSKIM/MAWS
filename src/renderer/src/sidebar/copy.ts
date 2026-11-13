// The sidebar's own words (P5 O2 M2: the Keep running action, docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M2
// "Keep"): a kept session is never stopped for being idle, though the memory budget may still release it.
export const KEEP_RUNNING = {
  keep: 'Keep running',
  stopKeeping: 'Stop keeping running',
} as const;

// UX wave U7, O-16 (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, Interfaces §L): a
// session row's Hide and Unhide, and its project's Hidden row.
export const HIDDEN = {
  hide: 'Hide',
  unhide: 'Unhide',
  row: (count: number) => `Hidden · ${count}`,
  label: (count: number) => `Hidden, ${count} ${count === 1 ? 'session' : 'sessions'}`,
} as const;
