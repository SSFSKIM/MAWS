// The `#panel` harness's automation surface, `window.__maws_harness.panel` (C8a execution document, Interfaces
// *Harness API*). Types only, so the e2e project can import them. M1 carries the host's half; M2 adds the summary's
// seams (setSession, setStatus, setDigest, loadTranscript, transcript) and M4 the R7 probes and the width controls.
// The fake sessions' app ids are 'A' and 'B' themselves.
export type FakeSessionId = 'A' | 'B';

export interface PanelHarnessStubProbe {
  counter(): number; // the newest live instance's +1 count
  vetoNextClose(): void; // the next beforeClose of this tool refuses, and the body offers "Close anyway"
  instances(): string[]; // live instance ids, in creation order
  opens(): number; // open() calls
  unregister(): void; // runs the registration's disposer
}

export interface PanelHarnessTab {
  id: string;
  toolId: string;
  pinned: boolean;
  active: boolean; // selected in the shown session's list (or the no-session selection)
  title: string;
  // C9 start: the fields C9's page reported (e2e/terminal.spec.ts reads them)
  selected: boolean; // the same as `active`
  home: string | null; // the session whose own list holds the tab; for a pin, the shown session
  terminalId: string | null; // a Terminal tab's registry terminal
  // C9 end
}

export interface PanelHarnessApi {
  switchSession(id: FakeSessionId | null): void; // null focuses the Overview tab
  addTool(toolId: string, opts?: { appSessionId?: FakeSessionId | null; params?: unknown; pin?: boolean; activate?: boolean }): string; // appSessionId defaults to the shown fake session
  selectTab(tabId: string | null): void; // null (and C9's 'review') shows the summary
  closeTab(tabId: string): Promise<boolean>;
  pin(tabId: string): void; // the pin glyph: toggles
  showSummary(): void;
  tabs(): PanelHarnessTab[];
  stub(toolId: string): PanelHarnessStubProbe;
  maximize(on: boolean): void;
  collapse(on: boolean): void;
  setTheme(theme: 'light' | 'dark'): void;
  hydrated(): Promise<void>; // resolved once the layout store has read layout.json
  // C9 start: C9's page API, kept by the stand-in fold
  ready(): Promise<string[]>; // hydrated, the host's ptys re-adopted first; resolves with the re-adopted terminal ids
  session(): string | null; // the shown session
  sessions: { A: string; B: string };
  inputGuard: { arm(): void; disarm(): number }; // physical wheel, key and touch events cancelled and counted while armed
  // C9 end
}
