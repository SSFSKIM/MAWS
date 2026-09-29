// The `#panel` harness's automation surface, `window.__maws_harness.panel` (C8a execution document, Interfaces
// *Harness API*). Types only, so the e2e project can import them. M1 carries the host's half; M2 adds the summary's
// seams (setSession, setStatus, setDigest, loadTranscript, transcript) and M4 the R7 probes and the width control.
// The fake sessions' app ids are 'A' and 'B' themselves.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import type { SessionDigest } from '@shared/ipc/schema';

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

// R7's reading of the child transcript inside the region (M4). `rows` is the store's row count, `domRows` the list's row
// elements, `visibleRows` those intersecting the list's scroll element, `overscan` C6's OVERSCAN; `lastRowInView` is
// the last row's rect inside the scroll element; `scrollWidth` and `clientWidth` are the region's slot element's, and
// `overflowX` the widest horizontal overflow of the slot, the host's tab panel and the list's scroll element (a
// transcript that overflows sideways scrolls inside its own list, which the slot alone would not show);
// `regionWidth` the rendered width of the panel region; `pendingRequests` the child's request_slot rows.
export interface PanelChildMetrics {
  rows: number;
  domRows: number;
  visibleRows: number;
  overscan: number;
  following: boolean;
  lastRowInView: boolean;
  scrollWidth: number;
  clientWidth: number;
  overflowX: number;
  regionWidth: number;
  pendingRequests: number;
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
  // M2: the summary's seams. The e2e points A at a scratch repository through setSession; setStatus(id, null) makes a
  // session disk-only. loadTranscript plays one of C6's fixtures and attaches it under the fake session's own key too,
  // so the summary reads entries[id] as the product does; it releases everything, or the events below `releaseTo` (a
  // seq: C6's seek releases strictly below it), the rest through transcript(id).release(n).
  setSession(id: FakeSessionId, patch: Partial<SessionRecord>): void;
  setStatus(id: FakeSessionId, status: EngineSessionStatus | null): void;
  setDigest(id: FakeSessionId, patch: Partial<SessionDigest>): void;
  loadTranscript(id: FakeSessionId, fixture: string, opts?: { releaseTo?: number }): Promise<void>;
  transcript(id: FakeSessionId): { expandAll(): void; collapseAll(): void; release(n: number): number }; // release answers how many events it released
  // M4: R7. The `child` tool (open it with addTool('child') after loading a fixture with a child agent) mounts C6's child
  // transcript over the loaded session's first child. release(n) steps the parent's player n events and resolves, two
  // frames later, with the child's row count; expandAll() expands the child's entry, then two frames.
  child: { release(n: number): Promise<number>; expandAll(): Promise<void>; metrics(): PanelChildMetrics };
  setWidth(px: 280 | 380 | 640): void; // the panel's width through C5's setPanel (restored and shown); C5's clamp applies
  collapseSidebar(on: boolean): void; // C5's sidebar column (the page's debug strip), so 640 renders as set in a window under 1420 px
  // C9 start: C9's page API, kept by the stand-in fold
  ready(): Promise<string[]>; // hydrated, the host's ptys re-adopted first; resolves with the re-adopted terminal ids
  session(): string | null; // the shown session
  sessions: { A: string; B: string };
  inputGuard: { arm(): void; disarm(): number }; // physical wheel, key and touch events cancelled and counted while armed
  // C9 end
}
