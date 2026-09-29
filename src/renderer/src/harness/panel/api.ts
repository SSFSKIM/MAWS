// The `#panel` harness's automation surface, `window.__maws_harness.panel` (C8a execution document, Interfaces
// *Harness API*). Types only, so the e2e project can import them. M1 carries the host's half; M2 adds the summary's
// seams (setSession, setStatus, setDigest, loadTranscript, transcript) and M4 the R7 probes and the width controls.
export type FakeSessionId = 'A' | 'B';

export interface PanelHarnessStubProbe {
  counter(): number; // the newest live instance's +1 count
  vetoNextClose(): void; // the next beforeClose of this tool refuses, and the body offers "Close anyway"
  instances(): string[]; // live instance ids, in creation order
  opens(): number; // open() calls
  unregister(): void; // runs the registration's disposer
}

export interface PanelHarnessApi {
  switchSession(id: FakeSessionId | null): void; // null focuses the Overview tab
  addTool(toolId: string, opts?: { appSessionId?: FakeSessionId | null; params?: unknown; pin?: boolean; activate?: boolean }): string; // appSessionId defaults to the shown fake session
  selectTab(tabId: string): void;
  closeTab(tabId: string): Promise<boolean>;
  pin(tabId: string): void; // the pin glyph: toggles
  showSummary(): void;
  tabs(): { id: string; toolId: string; pinned: boolean; active: boolean; title: string }[];
  stub(toolId: string): PanelHarnessStubProbe;
  maximize(on: boolean): void;
  collapse(on: boolean): void;
  setTheme(theme: 'light' | 'dark'): void;
  hydrated(): Promise<void>; // resolved once the layout store has read layout.json
}
