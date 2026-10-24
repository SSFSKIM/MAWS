// The tab and pane model (C5 execution document, "Tab and pane transitions"; residue *Tab strip* and *Split*): pure
// functions over the persisted `main.tabs` value, one per row of the transition table, so the table is testable
// without a store. At most two panes (D-8). The Overview is not a tab (W5, §5.2 as amended 2026-10-01): it floats over
// the main area, so the only pane may be empty. W12 (I3): one pane layout per project, a set (`main.sets`), the strip
// showing the current one (`main.current`); a tab id exists at most once across every set, and the closed-tab history
// is shared. A transition works on the current set unless it says otherwise; one that finds its tab in another set
// works there.
import type { AppSessionId } from '@shared/graph/ids';
import {
  EMPTY_TAB_SET, NO_PROJECT, tabId, UNPINNABLE_KINDS, type LayoutMain, type LayoutMainV1, type PaneState, type TabRef, type TabSet, type TabSetKey,
  type TabTarget,
} from '@shared/ipc/schema/layout';

type Pane = 0 | 1;
export type PaneTarget = Pane | 'focused' | 'other';
// What a set's own transitions work on: its panes, with the shared closed-tab history.
type View = TabSet & { closedTabs: TabRef[] };
// Which set a tab belongs in: its session's project's, null for a tab of no session (it stays where it is opened).
export type SetOfTab = (tab: TabRef) => TabSetKey | null;

const CLOSED_MAX = 10;

const toRef = (target: TabTarget): TabRef => ({ ...target, id: tabId(target), pinned: false }) as TabRef;

// ---- the sets ----------------------------------------------------------------------------------------------------------

// The set the strip shows.
export const currentSet = (main: LayoutMain): TabSet => main.sets[main.current] ?? EMPTY_TAB_SET;

const setKeys = (main: LayoutMain): TabSetKey[] => Object.keys(main.sets) as TabSetKey[];
const isEmpty = (set: TabSet) => set.panes.every((p) => p.tabs.length === 0);

// Every tab of every set (usage, the viewer's pruning, a close guard's lookup).
export const allTabs = (main: LayoutMain): TabRef[] => setKeys(main).flatMap((key) => main.sets[key]?.panes.flatMap((p) => p.tabs) ?? []);

// Where tab `id` is: its set (the current one looked at first), pane and index.
export function locateTab(main: LayoutMain, id: string): { set: TabSetKey; pane: Pane; index: number } | null {
  for (const set of [main.current, ...setKeys(main).filter((k) => k !== main.current)]) {
    const view = main.sets[set];
    const at = view ? locate(view, id) : null;
    if (at) return { set, ...at };
  }
  return null;
}

export const isOpen = (main: LayoutMain, id: string): boolean => locateTab(main, id) !== null;

// The current set always has an entry; any other set is kept only while it holds a tab.
function tidy(main: LayoutMain): LayoutMain {
  const empty = setKeys(main).filter((key) => key !== main.current && isEmpty(main.sets[key] ?? EMPTY_TAB_SET));
  if (empty.length === 0 && main.sets[main.current]) return main;
  const sets = { ...main.sets };
  for (const key of empty) delete sets[key];
  sets[main.current] ??= EMPTY_TAB_SET;
  return { ...main, sets };
}

// Runs a set's own transition on set `key` (created empty when absent) and writes it back; an unchanged view leaves
// `main` as it was, so nothing is persisted for a no-op.
function onSet(main: LayoutMain, key: TabSetKey, fn: (view: View) => View): LayoutMain {
  const before: View = { ...(main.sets[key] ?? EMPTY_TAB_SET), closedTabs: main.closedTabs };
  const after = fn(before);
  if (after === before) return main;
  return tidy({ ...main, sets: { ...main.sets, [key]: keptFloat(before, asSet(after)) }, closedTabs: after.closedTabs });
}

// P4-B3 (X37): a float belongs to the pane that collapsed. A transition that leaves its session tab active in the other
// pane (⌘\, "Open in split", a drag between the strips) docks the split rather than floating the pane beside it.
function keptFloat(before: TabSet, after: TabSet): TabSet {
  const was = floatingPane(before);
  const now = floatingPane(after);
  return was === null || now === null || was === now ? after : asSet({ ...after, floating: undefined });
}

// P4-B3 (X37; its Decision Log 6): the float is normalised rather than policed. Every set written back keeps `floating`
// only while it names the active session tab of one of two panes, so every transition docks a float its change ended:
// A's last tab closing (one pane, S full width), S's tab closing or changing (docked at the ratio, or A alone), the
// session removed; `keptFloat` adds S's tab leaving its pane. A float in a set the strip does not show stays stored
// with it.
const asSet = ({ panes, focusedPane, splitRatio, floating }: TabSet): TabSet => {
  const set: TabSet = { panes, focusedPane, splitRatio };
  if (!floating || floatingPane({ ...set, floating }) === null) return set;
  return { ...set, floating: floating.foldedPanel ? { sessionTabId: floating.sessionTabId, foldedPanel: true } : { sessionTabId: floating.sessionTabId } };
};

const onCurrent = (main: LayoutMain, fn: (view: View) => View): LayoutMain => onSet(main, main.current, fn);

// The strip shows set `key` (a project clicked in the sidebar, an open of a tab another set holds or of another
// project's session): created empty when it has none; the set it leaves goes if it is empty (W12: an emptied set stays
// current, showing the empty pane, until the strip moves on).
export function switchSet(main: LayoutMain, key: TabSetKey): LayoutMain {
  if (key === main.current && main.sets[key]) return main;
  return tidy({ ...main, current: key });
}

// Tab `at` leaves its set for set `to`, after the active tab of `to`'s focused pane, keeping its pin; neither the
// strip nor the active tab of `to` changes (a pane it is the first tab of activates it).
function moveToSet(main: LayoutMain, at: { set: TabSetKey; pane: Pane; index: number }, to: TabSetKey): LayoutMain {
  const tab = paneAt(main.sets[at.set] as TabSet, at.pane).tabs[at.index];
  const left = onSet(main, at.set, (v) => withPanes(v, v.panes.map((p, i) => (i === at.pane ? without(p, tab.id) : p)), v.focusedPane));
  return onSet(left, to, (v) => place(v, tab, v.focusedPane, 'afterActive', false));
}

// ---- reading a set -----------------------------------------------------------------------------------------------------

// The pane at an index the caller knows exists (the focused pane, or one `locate` found).
const paneAt = (view: TabSet, pane: Pane): PaneState => view.panes[pane] as PaneState;

// P4-B3 (X37): the pane that has yielded into the floating card: the one whose active tab is the set's floating session
// tab, while the set has two panes; null while docked.
export function floatingPane(set: TabSet): Pane | null {
  const id = set.floating?.sessionTabId;
  if (id === undefined || set.panes.length !== 2) return null;
  const pane = set.panes.findIndex((p) => p.activeTabId === id);
  return pane !== -1 && paneShowsSession(set, pane as Pane) ? (pane as Pane) : null;
}

// Whether pane `pane`'s active tab is a session tab: the pane that may float (an agent tab has no composer).
export function paneShowsSession(set: TabSet, pane: Pane): boolean {
  const p = set.panes[pane];
  return p?.tabs.some((t) => t.id === p.activeTabId && t.kind === 'session') ?? false;
}

// The active tab of the current set's focused pane: what the toolbar titles and the right panel follows.
export function activeTab(main: LayoutMain): TabRef | null {
  const set = currentSet(main);
  const pane = set.panes[set.focusedPane] ?? set.panes[0];
  return pane.tabs.find((t) => t.id === pane.activeTabId) ?? null;
}

// The session a tab belongs to, which the right panel shows (C8's tenth ask): a session, agent or diff tab's, a file
// tab's when it was opened from a session; none for the app-wide tabs.
export function sessionOfTab(tab: TabTarget | null): AppSessionId | null {
  switch (tab?.kind) {
    case 'session':
    case 'agent':
    case 'diff':
    case 'file':
    case 'browser': // E4a
      return tab.appSessionId;
    default:
      return null;
  }
}

function locate(view: TabSet, id: string): { pane: Pane; index: number } | null {
  for (const pane of [0, 1] as const) {
    const index = view.panes[pane]?.tabs.findIndex((t) => t.id === id) ?? -1;
    if (index !== -1) return { pane, index };
  }
  return null;
}

// Pinned tabs precede unpinned, keeping relative order.
const pinnedFirst = (tabs: TabRef[]) => [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];

function withPanes(view: View, panes: PaneState[], focusedPane: Pane): View {
  const kept = panes.filter((p) => p.tabs.length > 0);
  if (kept.length === 0) return { ...view, panes: EMPTY_TAB_SET.panes, focusedPane: 0 };
  const focus: Pane = kept.length === 1 ? 0 : panes[0].tabs.length === 0 ? 0 : focusedPane;
  return { ...view, panes: kept.length === 1 ? [kept[0]] : [kept[0], kept[1]], focusedPane: focus };
}

// Removes a tab from its pane; if it was active the right neighbour, else the left, becomes active.
function without(pane: PaneState, id: string): PaneState {
  const index = pane.tabs.findIndex((t) => t.id === id);
  if (index === -1) return pane;
  const tabs = pane.tabs.filter((t) => t.id !== id);
  if (pane.activeTabId !== id || tabs.length === 0) return { tabs, activeTabId: tabs.length === 0 ? '' : pane.activeTabId };
  return { tabs, activeTabId: (tabs[index] ?? tabs[index - 1]).id };
}

// The pinned tabs first, then the rest; `index` is clamped into the tab's own region. An empty pane's first tab is its
// active one whatever `activate` says.
function insertAt(pane: PaneState, tab: TabRef, index: number, activate: boolean): PaneState {
  const pinnedEnd = pane.tabs.filter((t) => t.pinned).length;
  const clamp = (lo: number, hi: number) => Math.max(lo, Math.min(index, hi));
  const at = tab.pinned ? clamp(0, pinnedEnd) : clamp(pinnedEnd, pane.tabs.length);
  const tabs = [...pane.tabs.slice(0, at), tab, ...pane.tabs.slice(at)];
  return { tabs, activeTabId: activate || pane.tabs.length === 0 ? tab.id : pane.activeTabId };
}

const paneOf = (view: TabSet, target: PaneTarget): Pane => {
  if (target === 'focused') return view.focusedPane;
  if (target === 'other') return view.panes.length === 2 ? ((1 - view.focusedPane) as Pane) : 1;
  return target;
};

// Places a tab (not open anywhere) into a pane, creating pane 1 when asked for and absent. An empty only pane is never
// split: the tab goes into it (pane 0 is never left empty beside pane 1).
function place(view: View, tab: TabRef, pane: Pane, index: number | 'afterActive', activate: boolean): View {
  const panes = [...view.panes] as PaneState[];
  if (pane === 1 && panes.length === 1 && panes[0].tabs.length === 0) return place(view, tab, 0, index, activate);
  if (pane === 1 && panes.length === 1) {
    return { ...view, panes: [panes[0], { tabs: [tab], activeTabId: tab.id }], focusedPane: 1, splitRatio: 0.5 };
  }
  const target = panes[pane];
  const at = index === 'afterActive' ? target.tabs.findIndex((t) => t.id === target.activeTabId) + 1 : index;
  panes[pane] = insertAt(target, tab, at, activate);
  return { ...view, panes: panes as TabSet['panes'], focusedPane: pane };
}

function replaceTab(view: View, pane: Pane, index: number, tab: TabRef): View {
  const panes = [...view.panes] as PaneState[];
  panes[pane] = { ...panes[pane], tabs: panes[pane].tabs.map((t, i) => (i === index ? tab : t)) };
  return { ...view, panes: panes as TabSet['panes'] };
}

function activateIn(view: View, id: string): View {
  const found = locate(view, id);
  if (!found) return view;
  const panes = [...view.panes] as PaneState[];
  panes[found.pane] = { ...panes[found.pane], activeTabId: id };
  return { ...view, panes: panes as TabSet['panes'], focusedPane: found.pane };
}

function openIn(view: View, target: TabTarget, pane: PaneTarget, activate: boolean): View {
  const found = locate(view, tabId(target));
  if (found) {
    // The settings tab is one tab whatever its section: opening it again moves it to the section asked for. A file tab
    // is one tab per path whatever its line or session: opening it again takes the line and the session (null
    // included) of this open, keeping its pin, so the right panel follows the session that last opened it (C8's tenth
    // ask).
    const open = paneAt(view, found.pane).tabs[found.index];
    const updated =
      target.kind === 'settings' || target.kind === 'customize'
        ? replaceTab(view, found.pane, found.index, toRef(target))
        : target.kind === 'file' && open.kind === 'file'
          ? replaceTab(view, found.pane, found.index, { ...open, line: target.line, appSessionId: target.appSessionId })
          : view;
    return activate ? activateIn(updated, tabId(target)) : { ...updated, focusedPane: found.pane };
  }
  return place(view, toRef(target), paneOf(view, pane), 'afterActive', activate);
}

// Removes tab `id`, remembered for ⌘⇧T unless `remember` is false (P4-B3: a tab moved to the panel did not close).
function closeIn(view: View, id: string, remember = true): View {
  const found = locate(view, id);
  if (!found) return view;
  const tab = paneAt(view, found.pane).tabs[found.index];
  const panes = view.panes.map((p, i) => (i === found.pane ? without(p, id) : p));
  const next = withPanes(view, panes, view.focusedPane);
  return remember ? { ...next, closedTabs: [...view.closedTabs.filter((t) => t.id !== id), tab].slice(-CLOSED_MAX) } : next;
}

function moveIn(view: View, id: string, toPane: Pane, index: number): View {
  const found = locate(view, id);
  if (!found) return view;
  const tab = paneAt(view, found.pane).tabs[found.index];
  if (found.pane === toPane) {
    const pane = paneAt(view, toPane);
    const rest = pane.tabs.filter((t) => t.id !== id);
    const panes = [...view.panes] as PaneState[];
    panes[toPane] = insertAt({ tabs: rest, activeTabId: pane.activeTabId }, tab, index, true);
    return { ...view, panes: panes as TabSet['panes'], focusedPane: toPane };
  }
  const creating = toPane === 1 && view.panes.length === 1;
  const source = without(paneAt(view, found.pane), id);
  let panes: PaneState[] = view.panes.map((p, i) => (i === found.pane ? source : p));
  if (creating) panes = [panes[0], { tabs: [tab], activeTabId: tab.id }];
  else panes[toPane] = insertAt(panes[toPane], tab, index, true);
  const next = withPanes({ ...view, splitRatio: creating ? 0.5 : view.splitRatio }, panes, toPane);
  // When the emptied source was pane 0, the target has become pane 0.
  return source.tabs.length === 0 ? { ...next, focusedPane: 0 } : next;
}

// ---- transitions -------------------------------------------------------------------------------------------------------

// `set` is where a tab of a session goes (the store passes its session's project's set): a tab not open anywhere opens
// there, the strip moving to it when the tab is activated; a tab open in another set moves there. A tab of no session
// (Settings, Diagnostics, a file opened from no session) belongs to the current set: open in another one, it moves to
// the current set (W12: a singleton follows the strip). Without `set`, a session's tab stays in the set that has it.
export function openTab(main: LayoutMain, target: TabTarget, opts: { pane?: PaneTarget; activate?: boolean; set?: TabSetKey } = {}): LayoutMain {
  const activate = opts.activate ?? true;
  const found = locateTab(main, tabId(target));
  const to = sessionOfTab(target) === null ? main.current : (opts.set ?? found?.set ?? main.current);
  const moved = found && found.set !== to ? moveToSet(main, found, to) : main;
  return onSet(activate ? switchSet(moved, to) : moved, to, (v) => openIn(v, target, opts.pane ?? 'focused', activate));
}

// How a session opens (I2, §5.2 as amended 2026-10-01): by default it takes the place of the focused pane's session
// (`replaceActive`); `how: 'tab'` gives it a tab of its own (⌘-click, middle-click, "Open in new tab", a fork); `split`
// opens it in the other pane ("Open in split", ⌘Enter), an already open session moving there.
export interface OpenSessionOptions {
  split?: boolean;
  how?: 'replace' | 'tab';
}

// `set`: the session's project's set (I3), which the strip moves to first.
export function openSession(main: LayoutMain, appSessionId: AppSessionId, opts: OpenSessionOptions & { set?: TabSetKey } = {}): LayoutMain {
  const target: TabTarget = { kind: 'session', appSessionId };
  if (!opts.split) return opts.how === 'tab' ? openTab(main, target, { set: opts.set }) : replaceActive(main, appSessionId, opts.set);
  const found = locateTab(main, tabId(target));
  const to = opts.set ?? found?.set ?? main.current;
  const shown = switchSet(found && found.set !== to ? moveToSet(main, found, to) : main, to);
  return onSet(shown, to, (v) => {
    const at = locate(v, tabId(target));
    const other = paneOf(v, 'other');
    if (!at) return openIn(v, target, other, true);
    if (v.panes.length === 2 && at.pane === other) return activateIn(v, tabId(target));
    const dest: Pane = v.panes.length === 2 ? other : 1;
    return moveIn(v, tabId(target), dest, v.panes[dest]?.tabs.length ?? 0);
  });
}

// I2: a session opened from the sidebar, the Overview or the palette replaces what the focused pane shows. Open anywhere,
// it is activated, the strip moving to its set; otherwise the strip moves to `set` (I3: the session's project's) and an
// unpinned tab active in its focused pane, of any kind (E11 F2b, plan 2.5; owner decision 2), gives its place to it
// under the session's own tab id, the old ref joining the closed-tab history for ⌘⇧T; a pinned tab or an empty pane is
// left alone and the session opens after it. A tab whose work replacing it would lose (an unsaved file, a launch in
// flight, a blank unstarted chat) is the store's to keep out of this (it asks for a tab of its own).
export function replaceActive(main: LayoutMain, appSessionId: AppSessionId, set?: TabSetKey): LayoutMain {
  const target: TabTarget = { kind: 'session', appSessionId };
  if (isOpen(main, tabId(target))) return openTab(main, target, { set });
  const to = set ?? main.current;
  const shown = switchSet(main, to);
  const old = activeTab(shown);
  if (old === null || old.pinned) return openTab(shown, target, { set });
  return onSet(shown, to, (v) => {
    const at = locate(v, old.id) as { pane: Pane; index: number };
    const tab = toRef(target);
    const panes = [...v.panes] as PaneState[];
    panes[at.pane] = { tabs: panes[at.pane].tabs.map((t) => (t.id === old.id ? tab : t)), activeTabId: tab.id };
    return { ...v, panes: panes as TabSet['panes'], closedTabs: [...v.closedTabs.filter((t) => t.id !== old.id), old].slice(-CLOSED_MAX) };
  });
}

// cua #90: tab `id` shows `target` from now on, in its place, with its pin and its being active (an options tab main
// replaced with a page: the tab it showed is gone, so nothing joins the closed-tab history); the strip and the focus stay.
// A tab not open, or a target open already (an id lives once), leaves the layout as it was.
export function retargetTab(main: LayoutMain, id: string, target: TabTarget): LayoutMain {
  const found = locateTab(main, id);
  if (!found || isOpen(main, tabId(target))) return main;
  return onSet(main, found.set, (v) => {
    const pane = paneAt(v, found.pane);
    const tab = { ...toRef(target), pinned: pane.tabs[found.index].pinned } as TabRef;
    const retargeted = replaceTab(v, found.pane, found.index, tab);
    if (pane.activeTabId !== id) return retargeted;
    const panes = [...retargeted.panes] as PaneState[];
    panes[found.pane] = { ...panes[found.pane], activeTabId: tab.id };
    return { ...retargeted, panes: panes as TabSet['panes'] };
  });
}

// Activates tab `id` wherever it is, the strip moving to its set.
export function activateTab(main: LayoutMain, id: string): LayoutMain {
  const found = locateTab(main, id);
  return found ? onSet(switchSet(main, found.set), found.set, (v) => activateIn(v, id)) : main;
}

export function focusPane(main: LayoutMain, pane: Pane): LayoutMain {
  return onCurrent(main, (v) => (pane < v.panes.length && pane !== v.focusedPane ? { ...v, focusedPane: pane } : v));
}

// `remember: false` (P4-B3, its Decision Log 32): a move is not a close, so the tab leaves no ⌘⇧T entry.
export interface CloseOptions {
  remember?: boolean;
}
export function closeTab(main: LayoutMain, id: string, opts: CloseOptions = {}): LayoutMain {
  const found = locateTab(main, id);
  return found ? onSet(main, found.set, (v) => closeIn(v, id, opts.remember ?? true)) : main;
}

// Within the current set (the strips show only it).
export function moveTab(main: LayoutMain, id: string, toPane: Pane, index: number): LayoutMain {
  return onCurrent(main, (v) => moveIn(v, id, toPane, index));
}

export function splitWithActive(main: LayoutMain): LayoutMain {
  return onCurrent(main, (v) => {
    const pane = paneAt(v, v.focusedPane);
    if (v.panes.length === 1 && pane.tabs.length < 2) return v;
    const to: Pane = v.panes.length === 2 ? ((1 - v.focusedPane) as Pane) : 1;
    return moveIn(v, pane.activeTabId, to, v.panes[to]?.tabs.length ?? 0);
  });
}

export function selectTab(main: LayoutMain, n: number): LayoutMain {
  return onCurrent(main, (v) => {
    const tab = paneAt(v, v.focusedPane).tabs[n - 1];
    return tab ? activateIn(v, tab.id) : v;
  });
}

export function cycleTab(main: LayoutMain, delta: 1 | -1): LayoutMain {
  return onCurrent(main, (v) => {
    const { tabs, activeTabId } = paneAt(v, v.focusedPane);
    if (tabs.length === 0) return v;
    const at = tabs.findIndex((t) => t.id === activeTabId);
    return activateIn(v, tabs[(at + delta + tabs.length) % tabs.length].id);
  });
}

// `at` is where the tab stood when it was closed, when the store remembers it; otherwise it opens like any tab. `set`
// is where it goes (its session's project's; the current set for a tab of no session).
export function reopenClosed(main: LayoutMain, at: number | null, set?: TabSetKey): LayoutMain {
  const tab = main.closedTabs.at(-1);
  if (!tab) return main;
  const rest = { ...main, closedTabs: main.closedTabs.slice(0, -1) };
  if (isOpen(rest, tab.id)) return activateTab(rest, tab.id);
  const to = set ?? main.current;
  return onSet(switchSet(rest, to), to, (v) => place(v, tab, v.focusedPane, at ?? 'afterActive', true));
}

export function togglePinned(main: LayoutMain, id: string): LayoutMain {
  const found = locateTab(main, id);
  if (!found) return main;
  return onSet(main, found.set, (v) => {
    if (UNPINNABLE_KINDS.has(paneAt(v, found.pane).tabs[found.index].kind)) return v;
    const panes = [...v.panes] as PaneState[];
    const pane = panes[found.pane];
    panes[found.pane] = { ...pane, tabs: pinnedFirst(pane.tabs.map((t) => (t.id === id ? ({ ...t, pinned: !t.pinned } as TabRef) : t))) };
    return { ...v, panes: panes as TabSet['panes'] };
  });
}

const belongsTo = (tab: TabRef, appSessionId: AppSessionId) => (tab.kind === 'session' || tab.kind === 'agent') && tab.appSessionId === appSessionId;

// `session.removed`: the session's session and agent tabs close, in every set, without a closed-tab entry; it cannot be
// reopened.
export function dropSession(main: LayoutMain, appSessionId: AppSessionId): LayoutMain {
  let next = main;
  for (const key of setKeys(main)) {
    next = onSet(next, key, (v) => {
      const gone = v.panes.flatMap((p) => p.tabs).filter((t) => belongsTo(t, appSessionId));
      if (gone.length === 0) return v;
      return withPanes(v, v.panes.map((p) => gone.reduce((pane, t) => without(pane, t.id), p)), v.focusedPane);
    });
  }
  const closedTabs = next.closedTabs.filter((t) => !belongsTo(t, appSessionId));
  return closedTabs.length === next.closedTabs.length ? next : { ...next, closedTabs };
}

// P4-B3 (its Decision Log 3): the pixel floors are the divider's and the render's (`main/split.ts`), so the model only
// keeps the ratio sane.
export function setSplitRatio(main: LayoutMain, ratio: number): LayoutMain {
  const splitRatio = Number.isFinite(ratio) ? Math.min(0.99, Math.max(0.01, ratio)) : 0.5;
  return onCurrent(main, (v) => ({ ...v, splitRatio }));
}

// P4-B3 (X37; its Decision Log 1, 2, 4): the current set's pane showing session tab `sessionTabId` yields into the
// floating card; `splitRatio` is left as it was, so Dock returns the ratio at pointer-down. Nothing changes unless the
// set is a split with that session tab active in a pane. P4-B3x: `foldedPanel` marks the float as Expand's with the
// right panel folded by it (the layout store folds the panel in the same change).
export function floatSplit(main: LayoutMain, sessionTabId: string, opts: { foldedPanel?: boolean } = {}): LayoutMain {
  return onCurrent(main, (v) => {
    if (v.floating?.sessionTabId === sessionTabId) return v;
    const next: View = { ...v, floating: opts.foldedPanel ? { sessionTabId, foldedPanel: true } : { sessionTabId } };
    return floatingPane(next) === null ? v : next;
  });
}

// P4-B3x (P4 Decision Log 40): the float whose Expand folded the right panel, and its set; null when no fold stands.
// The store keeps at most one: a fold is made only over an open panel and dropped whenever the panel opens.
export function foldOf(main: LayoutMain): { set: TabSetKey; sessionTabId: string } | null {
  for (const key of setKeys(main)) {
    const floating = main.sets[key]?.floating;
    if (floating?.foldedPanel) return { set: key, sessionTabId: floating.sessionTabId };
  }
  return null;
}

// Whether the fold standing in `before` ended with its float in `after` (a dock, Restore split, or any transition that
// ended the float), rather than by the mark being dropped while the float stays.
export function foldEnded(before: LayoutMain, after: LayoutMain): boolean {
  const fold = foldOf(before);
  return fold !== null && after.sets[fold.set]?.floating?.sessionTabId !== fold.sessionTabId;
}

// Every fold mark dropped, the floats kept (the owner opened the panel: leaving Expand then leaves it as they set it);
// `main` itself when none stands.
export function unfold(main: LayoutMain): LayoutMain {
  const fold = foldOf(main);
  if (fold === null) return main;
  const set = main.sets[fold.set] as TabSet;
  return unfold({ ...main, sets: { ...main.sets, [fold.set]: { ...set, floating: { sessionTabId: fold.sessionTabId } } } });
}

// The floating pane comes back beside the other at the stored ratio; `floating` goes from the value.
export function dockSplit(main: LayoutMain): LayoutMain {
  return onCurrent(main, (v) => (v.floating ? { ...v, floating: undefined } : v));
}

// W12: a tab whose session's project changed (a New chat given its project, a record refolded into another project)
// moves to that project's set, after the active tab of its focused pane; when it is what the strip shows, the strip
// follows it. Nothing moves, nothing changes.
export function refile(main: LayoutMain, setOf: SetOfTab): LayoutMain {
  let next = main;
  for (const tab of allTabs(main)) {
    const to = setOf(tab);
    const at = locateTab(next, tab.id);
    if (to === null || !at || at.set === to) continue;
    const shown = at.set === next.current && activeTab(next)?.id === tab.id;
    next = moveToSet(next, at, to);
    if (shown) next = activateTab(next, tab.id);
  }
  return next;
}

// Hydration: a session or agent tab whose record no longer exists is dropped silently, a tab id exists once across
// every set (the current set's copy kept), pinned tabs precede the rest, every pane's active tab is one of its tabs, a
// set left with nothing goes unless it is the current one, which falls back to one empty pane.
export function repairMain(main: LayoutMain, known: (appSessionId: AppSessionId) => boolean): LayoutMain {
  const keep = (t: TabRef) => (t.kind !== 'session' && t.kind !== 'agent') || known(t.appSessionId);
  const seen = new Set<string>();
  const sets: LayoutMain['sets'] = {};
  for (const key of [main.current, ...setKeys(main).filter((k) => k !== main.current)]) {
    const set = main.sets[key];
    if (!set) continue;
    const panes = set.panes.map((p): PaneState => {
      const tabs = pinnedFirst(p.tabs.filter((t) => keep(t) && !seen.has(t.id) && seen.add(t.id)));
      return { tabs, activeTabId: tabs.some((t) => t.id === p.activeTabId) ? p.activeTabId : (tabs[0]?.id ?? '') };
    });
    sets[key] = asSet(withPanes({ ...set, closedTabs: [] }, panes, set.focusedPane));
  }
  return tidy({ ...main, sets, closedTabs: main.closedTabs.filter(keep) });
}

// W12: version 1's one layout filed into sets by each tab's session's project (`setOf`; a tab of no session goes with
// the current set). The current set is the active tab's, else that of the first tab with a session in the focused pane,
// else 'none'. Each set keeps the panes its tabs came from, their order, the active tabs (else the first) and the
// focused pane where it can.
export function fromV1(v1: LayoutMainV1, setOf: SetOfTab): LayoutMain {
  const focused = v1.panes[v1.focusedPane] ?? v1.panes[0];
  const shown = focused.tabs.find((t) => t.id === focused.activeTabId);
  const current = (shown ? setOf(shown) : null) ?? focused.tabs.map(setOf).find((key) => key !== null) ?? NO_PROJECT;
  const home = (tab: TabRef): TabSetKey => setOf(tab) ?? current;
  const view: View = { panes: v1.panes, focusedPane: v1.focusedPane, splitRatio: v1.splitRatio, closedTabs: [] };
  const sets: LayoutMain['sets'] = {};
  for (const key of new Set([current, ...v1.panes.flatMap((p) => p.tabs.map(home))])) {
    const panes = v1.panes.map((p): PaneState => {
      const tabs = p.tabs.filter((t) => home(t) === key);
      return { tabs, activeTabId: tabs.some((t) => t.id === p.activeTabId) ? p.activeTabId : (tabs[0]?.id ?? '') };
    });
    sets[key] = asSet(withPanes(view, panes, v1.focusedPane));
  }
  return tidy({ version: 2, current, sets, closedTabs: v1.closedTabs });
}
