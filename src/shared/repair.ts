// The repair window's contract (P5 O15 M2, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, Interfaces §B):
// what main tells the page and what the page asks back, over three channels of the window's own. Shared by main
// (src/main/repair/), the window's preload (src/preload/repair.ts) and its page (src/renderer/src/repair/), and by
// nothing else: the page loads when nothing of the app can, so it reads none of the app's stores or IPC.

// The launch's failure (src/main/hosts/daemon.ts's UnavailableKind, the same four)
export type RepairKind = 'no-unit' | 'not-loaded' | 'install-refused' | 'not-started';

export interface RepairState {
  kind: RepairKind;
  why: string;
  packaged: boolean; // decides the retry action's label
  attempting: boolean; // an attempt is running: the actions are disabled
  log: { path: string; lines: string[] } | null;
}
export type RepairAction = 'retry' | 'open-login-items' | 'reveal-log' | 'quit';

export const REPAIR_ACTIONS: readonly RepairAction[] = ['retry', 'open-login-items', 'reveal-log', 'quit'];

export const REPAIR_CHANNELS = { state: 'repair.state', changed: 'repair.changed', act: 'repair.act' } as const;

// What the page's preload exposes as `window.repair`
export interface RepairBridge {
  state(): Promise<RepairState>;
  onState(listener: (state: RepairState) => void): () => void;
  act(action: RepairAction): void;
}
