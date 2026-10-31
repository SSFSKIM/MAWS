// The transcript harness's automation surface, `window.__maws_harness` (C6 execution document, "Replay stub, synthetic
// fixtures and harness"); Playwright drives the harness through it. Types only, so the e2e project can import them.

export interface HarnessMetrics {
  frameIntervals: number[]; // requestAnimationFrame intervals (ms) since the last play()
  longTasks: { start: number; duration: number }[]; // PerformanceObserver 'longtask' entries since the last play()
  rows: number; // rows in the list
  domRows: number; // row elements in the DOM
  deriveMs: number; // the last derivation of the row list
  lastBatchMs: number; // applying the last released batch
  batches: number; // batches applied since load
  following: boolean;
}

export interface HarnessLoad {
  ms: number; // from the call until the list has painted
  rows: number;
  events: number;
}

export interface HarnessApi {
  load(fixture: string): Promise<HarnessLoad>;
  play(speed?: number): void;
  pause(): void;
  step(): void;
  turnId(n: number): string; // the n-th turn's id (1-based, reading order); rows carry it as `data-turn-id`
  expandAll(options?: { cells?: boolean }): Promise<void>; // every turn and group; with `cells`, every cell's detail too
  expandTurn(n: number): Promise<void>;
  scrollToTurn(n: number): Promise<void>;
  metrics(): HarnessMetrics;
  setEffort(effort: string | null): void; // W8: the session effort the live thinking label names (none by default)
  // The long-transcript window: the fixture as a long session's disk history, opened on its newest window, each older
  // page `delayMs` away (paged.ts); `turns` how many of its `total` turns the open drew
  loadPaged(fixture: string, delayMs: number): Promise<HarnessLoad & { turns: number; total: number }>;
  // A jump to the first text of the fixture's `n`-th turn, as an attention item's mark makes one (the store's
  // `reachMessage`), or to a message in none of its history (`'missing'`); not awaited
  reach(n: number | 'missing'): void;
  rowOfText(n: number): string | null; // the row the n-th turn's first text is drawn in, null while it is not loaded
}
