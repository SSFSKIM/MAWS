// The composer and card harness's automation surface, `window.__maws_cards` (C7 execution document, M2 and M4):
// Playwright drives the page through it. Types only, so the e2e project can import them.
export type HarnessPlacement = 'docked' | 'card' | 'hover' | 'inline';

// What a pane shows: a session's waiting request in one placement, a focusable region whose `request.accept` binding
// only counts (the other pane of acceptance item 2, which must keep its Enter to itself), or (M4) a session's composer.
// M4b: a composer pane may show the session's transcript above it (C6's slot, whose bubbles offer Edit).
// M6: or sit in C5's own session pane (`shell`), which centres an unstarted session's frame under its heading; such a
// pane spans the page (the mockup checklist's screenshots).
// W2: `wide` spans the page (a transcript pane's column then reaches its cap).
export type HarnessPane = { appSessionId: string; placement: HarnessPlacement } | { counter: true } | { composer: string; transcript?: boolean; shell?: boolean; wide?: boolean } | null;

// M4: the stub of C10's setup intent the page registers (the fields the composer reads).
export interface HarnessIntent {
  location: { kind: 'directory'; path: string };
  additionalDirectories: string[];
  model: string | null;
  effort: null;
  permissionMode: null;
  message: { content: unknown; display: string } | null;
  draft: null;
}

export interface CardsHarnessApi {
  show(panes: [HarnessPane, HarnessPane]): void;
  counted(): number; // how many times a counter pane's `request.accept` fired
  // M4: the stub setup intent (null removes it), the starts and patches the composer made, and the answer to the oldest
  // start still pending; a stub card docked through `dockCard` in a DockedCardFrame, whose accepts are counted.
  intent(appSessionId: string, intent: HarnessIntent | null): void;
  starts(): { appSessionId: string; content: unknown; display: string }[];
  answerStart(result: { ok: true } | { ok: false; error: string }): void;
  patches(): { appSessionId: string; patch: Record<string, unknown> }[];
  dockStub(appSessionId: string): void;
  undockStub(): void;
  stubAccepts(): number;
  // M4b: the next `session.send` a composer makes for the session fails without reaching main (an injected write
  // failure); the rewind state machine's window, shortened for a run (null restores C3's 60 s).
  failNextSend(appSessionId: string): void;
  rewindWindow(ms: number | null): void;
}
