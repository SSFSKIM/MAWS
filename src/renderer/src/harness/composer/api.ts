// The composer and card harness's automation surface, `window.__maws_cards` (C7 execution document, M2): Playwright
// drives the page through it. Types only, so the e2e project can import them.
export type HarnessPlacement = 'docked' | 'card' | 'hover' | 'inline';

// What a pane shows: a session's waiting request in one placement, or a focusable region whose `request.accept`
// binding only counts (the other pane of acceptance item 2, which must keep its Enter to itself).
export type HarnessPane = { appSessionId: string; placement: HarnessPlacement } | { counter: true } | null;

export interface CardsHarnessApi {
  show(panes: [HarnessPane, HarnessPane]): void;
  counted(): number; // how many times a counter pane's `request.accept` fired
}
