// The sheet service's timing (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §C, §D), apart from the
// service so that src/services/command-budgets.ts reads it without composing anything.
export const SHEET_TIMING = {
  pollMs: 2000, // the sheet's root listed again, beside its watch: the root may not exist yet, and a file event can be lost
  debounceMs: 50, // a record re-read this long after a change under it
  putMs: 25_000, // one call of the door: it can wait on the record's lock and on the session's bridge, ten seconds each
} as const;

// `sheet.put`'s budget as main's machine host answers it: the door's own bound and its answer's way back. The command
// is usually proven already by the first read of a record with something open on it (the locator's probe).
export const SHEET_PUT_BUDGET_MS = 30_000;
