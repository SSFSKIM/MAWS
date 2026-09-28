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
  expandAll(): Promise<void>;
  expandTurn(n: number): Promise<void>;
  scrollToTurn(n: number): Promise<void>;
  metrics(): HarnessMetrics;
}
