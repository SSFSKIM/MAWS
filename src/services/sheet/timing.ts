// The sheet service's timing (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §C, §D, §E), apart from
// the service so that src/services/command-budgets.ts reads it without composing anything.
export const SHEET_TIMING = {
  pollMs: 2000, // the sheet's root listed again, beside its watch: a file event can be lost
  rootPollMs: 250, // while the sheet's root does not exist, how often it is looked for: its first record shows within a second
  debounceMs: 50, // a record re-read this long after a change under it
  probeMs: 10_000, // the locator's probe (`sminos sheet show`), at most
  putMs: 25_000, // one put, the probe and the door together: the door can wait on the record's lock and on the session's bridge, ten seconds each
} as const;

export type SheetTiming = { [K in keyof typeof SHEET_TIMING]: number };

// `sheet.put`'s budget as main's machine host answers it: the put's own bound and its answer's way back.
export const SHEET_PUT_BUDGET_MS = 30_000;
