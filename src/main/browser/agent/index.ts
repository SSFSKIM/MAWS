// The agent's presence in the in-app browser (E4c execution document, Design §8, §9, §11; the in-app browser spec of
// 2026-10-08, "Retained MAWS semantics"): what stays of E4c's browser tools now that cua_repl drives the tabs through
// cua's primitive server (P1 A-54). Started from `startBrowser` once cua's server exists, over the store's view hooks,
// so it covers every view, adopted pop-ups included, from the first: the `-run-dialog` wrap on every tab view
// (dialogs.ts, with cua's held route, A-53), the parking of unplaced tabs the agent works on (visible.ts, by control and
// by lease), and the e2e's seam. Who drives each tab (control.ts) and the agent's cursor (cursor.ts) are made by
// `startBrowser` before cua's server, which drives them; they are handed in.
//
// Under MAWS_E2E=1 the e2e's seam gains `agent` (`control`, `lastInputs`, `sendInput`, `cursorMessages`) on
// `globalThis.__maws_browser`, so the e2e plays the person and reads the cursor without an engine.
import type { KeyboardInputEvent, MouseInputEvent, MouseWheelInputEvent } from 'electron';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionStore } from '../../index/sessions';
import type { InputEmission } from '../input';
import type { BrowserEmit, TabEntry, TabStore } from '../tabs';
import type { ViewManager } from '../view';
import type { TabControls } from './control';
import type { AgentCursor } from './cursor';
import { PageDialogs, type PageDialogsDeps } from './dialogs';
import { Parking, type LeaseHolds } from './visible';

const LAST_INPUTS_KEPT = 32;

// P-24 (Decision Log 29): a side thread reaches its own tabs and its parent session's; anything else, including an
// index that cannot be read, reaches itself only.
export function reachableSessions(sessions: Pick<SessionStore, 'get'>, appSessionId: AppSessionId): AppSessionId[] {
  try {
    const lineage = sessions.get(appSessionId)?.lineage;
    if (lineage?.kind === 'side-thread') return [appSessionId, lineage.parentAppSessionId];
  } catch {
    // the index is unavailable: self only
  }
  return [appSessionId];
}

// Design §13 (b), Decision Log 36: under MAWS_E2E=1 tab ids are `b_` and a zero-padded sequence, starting above any
// sequence-shaped id restored from tabs.json (E4a's minter skips an id in use), so a fresh scene's first open is
// b_000000000001. Undefined otherwise (E4a's random ids).
export function e2eTabIds(env: NodeJS.ProcessEnv, restored: readonly { tabId: string }[]): (() => string) | undefined {
  if (env.MAWS_E2E !== '1') return undefined;
  let next = 1 + Math.max(0, ...restored.map(({ tabId }) => (/^b_\d{12}$/.test(tabId) ? Number(tabId.slice(2)) : 0)));
  return () => `b_${String(next++).padStart(12, '0')}`;
}

export interface BrowserAgentSeam {
  control(tabId: string): { control: TabEntry['tab']['control']; controlSince: string } | null;
  lastInputs(tabId: string): InputEmission[]; // E4a's classifier's last emissions for the tab
  // The person's stand-in (E4-0): an input event sent to the tab's page as the OS would, a mouse event's screen point
  // filled from the view's place on screen; false when the tab has no page
  sendInput(tabId: string, event: SeamInputEvent): boolean;
  cursorMessages(tabId: string): number; // how many `browser:cursor` messages the tab's pages were sent
}

export type SeamInputEvent = MouseInputEvent | MouseWheelInputEvent | KeyboardInputEvent;

declare module '../inspect' {
  interface BrowserInspector {
    agent?: BrowserAgentSeam; // E4c, under MAWS_E2E=1
  }
}

export interface AgentPresenceDeps {
  store: TabStore;
  emit: BrowserEmit;
  views: Pick<ViewManager, 'park'>; // E4a's view manager, for parking (visible.ts)
  controls: TabControls;
  cursor: AgentCursor;
  // the tabs cua's primitive server holds a lease on are parked; their dialogs take cua's held route (A-53)
  cua: LeaseHolds & { dialogs?: PageDialogsDeps['held'] };
}

export interface AgentPresence {
  seam: BrowserAgentSeam;
  dispose(): void;
}

export function startAgentPresence(deps: AgentPresenceDeps): AgentPresence {
  const { store, emit, controls, cursor } = deps;
  const log = (line: string) => console.warn(`[browser] ${line}`);
  const parking = new Parking({ store, views: deps.views, controls, leases: deps.cua });
  const dialogs = new PageDialogs({ store, emit, log, held: deps.cua.dialogs });

  const inputs = new WeakMap<TabEntry, InputEmission[]>();
  const stopInputs = store.onViewCreated((entry) => {
    if (inputs.has(entry)) return; // the seam outlives a view: one subscription per tab
    const kept: InputEmission[] = [];
    inputs.set(entry, kept);
    entry.input.on((emission) => {
      kept.push(emission);
      if (kept.length > LAST_INPUTS_KEPT) kept.shift();
    });
  });

  const seam: BrowserAgentSeam = {
    control: (tabId) => {
      const entry = store.entry(tabId);
      return entry ? { control: entry.tab.control, controlSince: entry.tab.controlSince } : null;
    },
    lastInputs: (tabId) => {
      const entry = store.entry(tabId);
      return entry ? [...(inputs.get(entry) ?? [])] : [];
    },
    sendInput: (tabId, event) => {
      const entry = store.entry(tabId);
      const contents = entry?.view?.webContents;
      if (!entry || !contents || contents.isDestroyed()) return false;
      contents.sendInputEvent('x' in event ? { ...screenPointOf(entry, event), ...event } : event);
      return true;
    },
    cursorMessages: (tabId) => {
      const entry = store.entry(tabId);
      return entry ? cursor.messages(entry) : 0;
    },
  };

  return {
    seam,
    dispose: () => {
      stopInputs();
      dialogs.dispose();
      parking.dispose();
    },
  };
}

// Where a point of the tab's page is on screen (E4-0's stand-in for the person, `pass2/main.mjs` `screenPoint`): the
// window's content origin plus the view's offset; an unplaced view counts from the origin.
function screenPointOf(entry: TabEntry, { x, y }: { x: number; y: number }): { globalX: number; globalY: number } {
  const host = entry.host && !entry.host.isDestroyed() ? entry.host.getContentBounds() : { x: 0, y: 0 };
  const view = entry.view!.getBounds();
  return { globalX: host.x + view.x + x, globalY: host.y + view.y + y };
}
