// The `#panel` harness's stand-in for C8a's panel host: which tabs exist, which session each belongs to, which are
// pinned (kept in a list of their own, shown in every session) and which is selected per session. It implements
// `PanelHostImplementation`, so `panelHost` (and through it `openTerminal` and a tool's `ctx.openTool`) lands here.
// Deliberately the harsher of the two host behaviours a tool must survive: an unselected tool is unmounted (the page
// renders only the selected tab), and its state lives here, created once per tab.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import { panelHost, type AddToolOptions, type PanelHostImplementation } from '../../panel/host';
import type { PanelTool } from '../../panel/tool';
import { terminals, type TerminalId } from '../../terminal/registry';
import { TERMINAL_TOOL_ID, type TerminalTabState } from '../../tools/terminal';
import { FAKE_SESSIONS, SESSION_A } from './fakeSessions';

export const REVIEW_TAB = 'review'; // the permanent placeholder tab, standing in for another tool being selected

export interface PanelTab {
  id: string;
  toolId: string;
  tool: PanelTool<unknown, unknown>; // the registration the tab was created with; it outlives an unregistration
  state: unknown;
  home: AppSessionId; // the session whose tab list holds it while it is not pinned
  ordinal: number; // "Terminal 2"
  suffix: string | null; // the tool's setTitle
  focusRequest: number;
  setTitle(suffix: string | null): void;
}

export interface PanelState {
  session: AppSessionId; // the session the panel shows
  tabs: Record<string, PanelTab>;
  sessionTabs: Partial<Record<AppSessionId, string[]>>;
  pinned: string[];
  active: Partial<Record<AppSessionId, string | null>>; // a tab id, REVIEW_TAB, or null for the summary
}

export const usePanel = create<PanelState>()(() => ({ session: SESSION_A, tabs: {}, sessionTabs: {}, pinned: [], active: {} }));
const get = usePanel.getState;
const set = usePanel.setState;

const toolOf = (toolId: string): PanelTool<unknown, unknown> => {
  const tool = panelHost.tools().find((t) => t.id === toolId);
  if (!tool) throw new Error(`no panel tool is registered as ${toolId}`);
  return tool;
};

// Pinned tabs first, then the session's own.
export const visibleTabs = (state: PanelState, session: AppSessionId): string[] => [...state.pinned, ...(state.sessionTabs[session] ?? [])];

export function tabTitle(tab: PanelTab): string {
  return `${tab.tool.title}${tab.ordinal > 1 ? ` ${tab.ordinal}` : ''}${tab.suffix ? ` · ${tab.suffix}` : ''}`;
}

export const terminalOf = (tab: PanelTab | undefined): TerminalId | null =>
  tab?.toolId === TERMINAL_TOOL_ID ? (tab.state as TerminalTabState).terminalId : null;

function createTab(toolId: string, id: string, home: AppSessionId, appSessionId: AppSessionId | null, params: unknown): PanelTab {
  const tool = toolOf(toolId);
  const state = tool.createState({ appSessionId, session: FAKE_SESSIONS[home] ?? null, instanceId: id, params });
  const used = new Set(Object.values(get().tabs).filter((tab) => tab.toolId === toolId).map((tab) => tab.ordinal));
  let ordinal = 1;
  while (used.has(ordinal)) ordinal++;
  const setTitle = (suffix: string | null) => {
    const tab = get().tabs[id];
    if (tab && tab.suffix !== suffix) set((s) => ({ tabs: { ...s.tabs, [id]: { ...tab, suffix } } }));
  };
  return { id, toolId, tool, state, home, ordinal, suffix: null, focusRequest: 0, setTitle };
}

function insert(tab: PanelTab, pin: boolean): void {
  set((s) => ({
    tabs: { ...s.tabs, [tab.id]: tab },
    ...(pin ? { pinned: [...s.pinned, tab.id] } : { sessionTabs: { ...s.sessionTabs, [tab.home]: [...(s.sessionTabs[tab.home] ?? []), tab.id] } }),
  }));
}

function selectIn(session: AppSessionId, id: string | null): void {
  set((s) => {
    const tab = id ? s.tabs[id] : undefined;
    return { active: { ...s.active, [session]: id }, ...(tab ? { tabs: { ...s.tabs, [tab.id]: { ...tab, focusRequest: tab.focusRequest + 1 } } } : {}) };
  });
}

function remove(id: string): PanelTab | undefined {
  const tab = get().tabs[id];
  if (!tab) return undefined;
  set((s) => {
    const tabs = { ...s.tabs };
    delete tabs[id];
    const sessionTabs = Object.fromEntries(Object.entries(s.sessionTabs).map(([session, ids]) => [session, ids!.filter((other) => other !== id)]));
    const pinned = s.pinned.filter((other) => other !== id);
    const next = { ...s, tabs, sessionTabs, pinned };
    const active = Object.fromEntries(Object.entries(s.active).map(([session, current]) => [session, current === id ? (visibleTabs(next, session as AppSessionId).at(-1) ?? null) : current]));
    return { tabs, sessionTabs, pinned, active };
  });
  return tab;
}

export function selectTab(id: string | null): void {
  selectIn(get().session, id);
}

// Activating a tab of another session shows that session, so the tab the caller asked for is on screen
// (`openTerminal` for B while A is shown lands in B, and B is shown).
function activateIn(session: AppSessionId, id: string): void {
  if (get().session !== session) set({ session });
  selectIn(session, id);
}

export function addTool(toolId: string, { appSessionId, params, pin = false, activate = true }: AddToolOptions<unknown>): string {
  const tool = toolOf(toolId);
  const home = appSessionId ?? get().session;
  if (!tool.multiInstance) {
    const existing = visibleTabs(get(), home).find((id) => get().tabs[id]!.toolId === toolId);
    if (existing) {
      tool.open?.(get().tabs[existing]!.state, params);
      if (activate) activateIn(home, existing);
      return existing;
    }
  }
  const id = `${toolId}:${crypto.randomUUID().slice(0, 8)}`;
  insert(createTab(toolId, id, home, appSessionId, params ?? {}), pin);
  if (activate) activateIn(home, id);
  return id;
}

// Runs the tool's veto; a vetoed close selects the tab so its own confirmation is in view.
export async function closeTab(id: string): Promise<boolean> {
  const tab = get().tabs[id];
  if (!tab) return true;
  const { tool } = tab;
  if (!(await tool.beforeClose(tab.state))) {
    if (visibleTabs(get(), get().session).includes(id)) selectTab(id);
    return false;
  }
  remove(id);
  tool.dispose(tab.state);
  return true;
}

export function togglePin(id: string): void {
  const s = get();
  const tab = s.tabs[id];
  if (!tab) return;
  if (s.pinned.includes(id)) {
    // Unpinning drops the tab into the list of the session shown now.
    remove(id);
    insert({ ...tab, home: s.session }, false);
    selectIn(s.session, id);
  } else {
    remove(id);
    insert(tab, true);
    selectIn(s.session, id);
  }
}

// A pinned tab that is selected stays selected in the next session (the same shell, D-10); otherwise the next session
// shows what it showed last, else its first tab.
export function switchSession(next: AppSessionId): void {
  const s = get();
  const current = s.active[s.session];
  const keep = current && s.pinned.includes(current) ? current : undefined;
  const target = keep ?? (next in s.active ? (s.active[next] ?? null) : (visibleTabs(s, next)[0] ?? null));
  set({ session: next });
  selectIn(next, target);
}

// A tool was unregistered: each of its tabs closes the way the owner's close would (the Terminal tool kills its
// shell in `beforeClose`), and a tab whose close is vetoed or fails stays, with its tool, so it can be retried.
export async function closeToolTabs(toolId: string): Promise<void> {
  await Promise.all(Object.values(get().tabs).filter((tab) => tab.toolId === toolId).map((tab) => closeTab(tab.id)));
}

export const panelHostImplementation: PanelHostImplementation = {
  addTool,
  selectTab,
  closeTab,
  showSummary: () => selectTab(null),
  closeToolTabs,
};

// The stand-in for the persisted panel layout C8 will restore after a reload: one Terminal tab per shell the registry
// re-adopted for a fake session, under that session, with the shell's label as its tab id.
export async function adoptTerminals(): Promise<TerminalId[]> {
  const ids = await terminals.adopt((info) => info.appSessionId in FAKE_SESSIONS);
  for (const id of ids) {
    const info = terminals.get(id)!.info;
    insert(createTab(TERMINAL_TOOL_ID, info.label, info.appSessionId, info.appSessionId, {}), false);
  }
  const s = get();
  if (!s.active[s.session]) selectTab(visibleTabs(s, s.session)[0] ?? REVIEW_TAB);
  return ids;
}
