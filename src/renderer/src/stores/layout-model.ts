// The tab and pane model (C5 execution document, "Tab and pane transitions"; residue *Tab strip* and *Split*): pure
// functions over the persisted `main.tabs` value, one per row of the transition table, so the table is testable
// without a store. At most two panes (D-8); Overview is permanent and first; a tab id exists at most once across panes.
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, tabId, UNPINNABLE_KINDS, type LayoutMain, type PaneState, type TabRef, type TabTarget } from '@shared/ipc/schema/layout';

type Pane = 0 | 1;
export type PaneTarget = Pane | 'focused' | 'other';

const CLOSED_MAX = 10;
const OVERVIEW: TabRef = { id: 'overview', kind: 'overview', pinned: true };

const toRef = (target: TabTarget): TabRef => {
  const id = tabId(target);
  if (target.kind === 'overview') return OVERVIEW;
  return { ...target, id, pinned: false } as TabRef;
};

// The pane at an index the caller knows exists (the focused pane, or one `locate` found).
const paneAt = (main: LayoutMain, pane: Pane): PaneState => main.panes[pane] as PaneState;

// The active tab of the focused pane: what the toolbar titles and the right panel follows.
export function activeTab(main: LayoutMain): TabRef | null {
  const pane = main.panes[main.focusedPane] ?? main.panes[0];
  return pane.tabs.find((t) => t.id === pane.activeTabId) ?? null;
}

// The session a tab belongs to, which the right panel shows (C8's tenth ask): a session, agent or diff tab's, a file
// tab's when it was opened from a session; none for the Overview and the app-wide tabs.
export function sessionOfTab(tab: TabRef | null): AppSessionId | null {
  switch (tab?.kind) {
    case 'session':
    case 'agent':
    case 'diff':
    case 'file':
      return tab.appSessionId;
    default:
      return null;
  }
}

function locate(main: LayoutMain, id: string): { pane: Pane; index: number } | null {
  for (const pane of [0, 1] as const) {
    const index = main.panes[pane]?.tabs.findIndex((t) => t.id === id) ?? -1;
    if (index !== -1) return { pane, index };
  }
  return null;
}

// Pinned tabs precede unpinned, keeping relative order (Overview is pinned, so it stays first).
const pinnedFirst = (tabs: TabRef[]) => [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];

function withPanes(main: LayoutMain, panes: PaneState[], focusedPane: Pane): LayoutMain {
  const kept = panes.filter((p) => p.tabs.length > 0);
  if (kept.length === 0) return { ...main, panes: LAYOUT_DEFAULTS.main.panes, focusedPane: 0 };
  const focus: Pane = kept.length === 1 ? 0 : panes[0].tabs.length === 0 ? 0 : focusedPane;
  return { ...main, panes: kept.length === 1 ? [kept[0]] : [kept[0], kept[1]], focusedPane: focus };
}

// Removes a tab from its pane; if it was active the right neighbour, else the left, becomes active.
function without(pane: PaneState, id: string): PaneState {
  const index = pane.tabs.findIndex((t) => t.id === id);
  if (index === -1) return pane;
  const tabs = pane.tabs.filter((t) => t.id !== id);
  if (pane.activeTabId !== id || tabs.length === 0) return { tabs, activeTabId: tabs.length === 0 ? '' : pane.activeTabId };
  return { tabs, activeTabId: (tabs[index] ?? tabs[index - 1]).id };
}

// Index 0 belongs to Overview wherever it is (§5.2: first and permanent), Overview itself included when it moves;
// then the pinned tabs, then the rest. `index` is clamped into the tab's own region.
function insertAt(pane: PaneState, tab: TabRef, index: number, activate: boolean): PaneState {
  const floor = tab.kind === 'overview' ? 0 : pane.tabs[0]?.kind === 'overview' ? 1 : 0;
  const pinnedEnd = pane.tabs.filter((t) => t.pinned).length; // Overview is pinned and first, so this is the pinned region's end
  const clamp = (lo: number, hi: number) => Math.max(lo, Math.min(index, hi));
  const at = tab.kind === 'overview' ? 0 : tab.pinned ? clamp(floor, pinnedEnd) : clamp(pinnedEnd, pane.tabs.length);
  const tabs = [...pane.tabs.slice(0, at), tab, ...pane.tabs.slice(at)];
  return { tabs, activeTabId: activate ? tab.id : pane.activeTabId };
}

const paneOf = (main: LayoutMain, target: PaneTarget): Pane => {
  if (target === 'focused') return main.focusedPane;
  if (target === 'other') return main.panes.length === 2 ? ((1 - main.focusedPane) as Pane) : 1;
  return target;
};

// Places a tab (not open anywhere) into a pane, creating pane 1 when asked for and absent.
function place(main: LayoutMain, tab: TabRef, pane: Pane, index: number | 'afterActive', activate: boolean): LayoutMain {
  const panes = [...main.panes] as PaneState[];
  if (pane === 1 && panes.length === 1) {
    return { ...main, panes: [panes[0], { tabs: [tab], activeTabId: tab.id }], focusedPane: 1, splitRatio: 0.5 };
  }
  const target = panes[pane];
  const at = index === 'afterActive' ? target.tabs.findIndex((t) => t.id === target.activeTabId) + 1 : index;
  panes[pane] = insertAt(target, tab, at, activate);
  return { ...main, panes: panes as LayoutMain['panes'], focusedPane: pane };
}

export function openTab(main: LayoutMain, target: TabTarget, opts: { pane?: PaneTarget; activate?: boolean } = {}): LayoutMain {
  const activate = opts.activate ?? true;
  const found = locate(main, tabId(target));
  if (found) {
    // The settings tab is one tab whatever its section: opening it again moves it to the section asked for. A file tab
    // is one tab per path whatever its line or session: opening it again takes the line and the session (null
    // included) of this open, keeping its pin, so the right panel follows the session that last opened it (C8's tenth
    // ask).
    const open = paneAt(main, found.pane).tabs[found.index];
    const updated =
      target.kind === 'settings'
        ? replaceTab(main, found.pane, found.index, toRef(target))
        : target.kind === 'file' && open.kind === 'file'
          ? replaceTab(main, found.pane, found.index, { ...open, line: target.line, appSessionId: target.appSessionId })
          : main;
    return activate ? activateTab(updated, tabId(target)) : { ...updated, focusedPane: found.pane };
  }
  return place(main, toRef(target), paneOf(main, opts.pane ?? 'focused'), 'afterActive', activate);
}

function replaceTab(main: LayoutMain, pane: Pane, index: number, tab: TabRef): LayoutMain {
  const panes = [...main.panes] as PaneState[];
  panes[pane] = { ...panes[pane], tabs: panes[pane].tabs.map((t, i) => (i === index ? tab : t)) };
  return { ...main, panes: panes as LayoutMain['panes'] };
}

// ⌘-click and "open in split": an already open session moves to the other pane.
export function openSession(main: LayoutMain, appSessionId: AppSessionId, opts: { split?: boolean } = {}): LayoutMain {
  const target: TabTarget = { kind: 'session', appSessionId };
  if (!opts.split) return openTab(main, target);
  const found = locate(main, tabId(target));
  const other = paneOf(main, 'other');
  if (!found) return openTab(main, target, { pane: other });
  if (main.panes.length === 2 && found.pane === other) return activateTab(main, tabId(target));
  const to: Pane = main.panes.length === 2 ? other : 1;
  return moveTab(main, tabId(target), to, main.panes[to]?.tabs.length ?? 0);
}

export function activateTab(main: LayoutMain, id: string): LayoutMain {
  const found = locate(main, id);
  if (!found) return main;
  const panes = [...main.panes] as PaneState[];
  panes[found.pane] = { ...panes[found.pane], activeTabId: id };
  return { ...main, panes: panes as LayoutMain['panes'], focusedPane: found.pane };
}

export function focusPane(main: LayoutMain, pane: Pane): LayoutMain {
  return pane < main.panes.length ? { ...main, focusedPane: pane } : main;
}

export function closeTab(main: LayoutMain, id: string): LayoutMain {
  if (id === 'overview') return main;
  const found = locate(main, id);
  if (!found) return main;
  const tab = paneAt(main, found.pane).tabs[found.index];
  const panes = main.panes.map((p, i) => (i === found.pane ? without(p, id) : p));
  const closed = [...main.closedTabs.filter((t) => t.id !== id), tab].slice(-CLOSED_MAX);
  return { ...withPanes(main, panes, main.focusedPane), closedTabs: closed };
}

export function moveTab(main: LayoutMain, id: string, toPane: Pane, index: number): LayoutMain {
  const found = locate(main, id);
  if (!found) return main;
  const tab = paneAt(main, found.pane).tabs[found.index];
  if (found.pane === toPane) {
    const pane = paneAt(main, toPane);
    const rest = pane.tabs.filter((t) => t.id !== id);
    const panes = [...main.panes] as PaneState[];
    panes[toPane] = insertAt({ tabs: rest, activeTabId: pane.activeTabId }, tab, index, true);
    return { ...main, panes: panes as LayoutMain['panes'], focusedPane: toPane };
  }
  const creating = toPane === 1 && main.panes.length === 1;
  const source = without(paneAt(main, found.pane), id);
  let panes: PaneState[] = main.panes.map((p, i) => (i === found.pane ? source : p));
  if (creating) panes = [panes[0], { tabs: [tab], activeTabId: tab.id }];
  else panes[toPane] = insertAt(panes[toPane], tab, index, true);
  const next = withPanes({ ...main, splitRatio: creating ? 0.5 : main.splitRatio }, panes, toPane);
  // When the emptied source was pane 0, the target has become pane 0.
  return source.tabs.length === 0 ? { ...next, focusedPane: 0 } : next;
}

export function splitWithActive(main: LayoutMain): LayoutMain {
  const pane = paneAt(main, main.focusedPane);
  if (main.panes.length === 1 && pane.tabs.length < 2) return main;
  const to: Pane = main.panes.length === 2 ? ((1 - main.focusedPane) as Pane) : 1;
  return moveTab(main, pane.activeTabId, to, main.panes[to]?.tabs.length ?? 0);
}

export function selectTab(main: LayoutMain, n: number): LayoutMain {
  const tab = paneAt(main, main.focusedPane).tabs[n - 1];
  return tab ? activateTab(main, tab.id) : main;
}

export function cycleTab(main: LayoutMain, delta: 1 | -1): LayoutMain {
  const { tabs, activeTabId } = paneAt(main, main.focusedPane);
  const at = tabs.findIndex((t) => t.id === activeTabId);
  return activateTab(main, tabs[(at + delta + tabs.length) % tabs.length].id);
}

// `at` is where the tab stood when it was closed, when the store remembers it; otherwise it opens like any tab.
export function reopenClosed(main: LayoutMain, at: number | null): LayoutMain {
  const tab = main.closedTabs.at(-1);
  if (!tab) return main;
  const rest = { ...main, closedTabs: main.closedTabs.slice(0, -1) };
  if (locate(rest, tab.id)) return activateTab(rest, tab.id);
  return place(rest, tab, rest.focusedPane, at ?? 'afterActive', true);
}

export function togglePinned(main: LayoutMain, id: string): LayoutMain {
  const found = locate(main, id);
  if (!found || UNPINNABLE_KINDS.has(paneAt(main, found.pane).tabs[found.index].kind)) return main;
  const panes = [...main.panes] as PaneState[];
  const pane = panes[found.pane];
  panes[found.pane] = { ...pane, tabs: pinnedFirst(pane.tabs.map((t) => (t.id === id ? ({ ...t, pinned: !t.pinned } as TabRef) : t))) };
  return { ...main, panes: panes as LayoutMain['panes'] };
}

const belongsTo = (tab: TabRef, appSessionId: AppSessionId) => (tab.kind === 'session' || tab.kind === 'agent') && tab.appSessionId === appSessionId;

// `session.removed`: the session's session and agent tabs close without a closed-tab entry; it cannot be reopened.
export function dropSession(main: LayoutMain, appSessionId: AppSessionId): LayoutMain {
  let panes: PaneState[] = [...main.panes];
  for (const tab of main.panes.flatMap((p) => p.tabs)) {
    if (belongsTo(tab, appSessionId)) panes = panes.map((p) => without(p, tab.id));
  }
  return { ...withPanes(main, panes, main.focusedPane), closedTabs: main.closedTabs.filter((t) => !belongsTo(t, appSessionId)) };
}

export function setSplitRatio(main: LayoutMain, ratio: number): LayoutMain {
  return { ...main, splitRatio: Math.min(0.75, Math.max(0.25, ratio)) };
}

// Hydration: a session or agent tab whose record no longer exists is dropped silently; Overview exists exactly once
// and leads its pane, pinned tabs precede the rest, every pane's active tab is one of its tabs, and an empty result
// falls back to the default.
export function repairMain(main: LayoutMain, known: (appSessionId: AppSessionId) => boolean): LayoutMain {
  const keep = (t: TabRef) => (t.kind !== 'session' && t.kind !== 'agent') || known(t.appSessionId);
  const seen = new Set<string>();
  const panes = main.panes.map((p): PaneState => {
    const tabs = pinnedFirst(p.tabs.filter((t) => keep(t) && !seen.has(t.id) && seen.add(t.id)));
    const overview = tabs.findIndex((t) => t.kind === 'overview');
    if (overview > 0) tabs.unshift(...tabs.splice(overview, 1)); // a hand-edited file cannot move Overview off index 0
    return { tabs, activeTabId: tabs.some((t) => t.id === p.activeTabId) ? p.activeTabId : (tabs[0]?.id ?? '') };
  });
  if (!seen.has('overview')) {
    const first = panes.find((p) => p.tabs.length > 0) ?? panes[0];
    first.tabs = [OVERVIEW, ...first.tabs];
    if (!first.activeTabId) first.activeTabId = 'overview';
  }
  const repaired = withPanes(main, panes, main.focusedPane);
  return { ...repaired, closedTabs: main.closedTabs.filter(keep) };
}
