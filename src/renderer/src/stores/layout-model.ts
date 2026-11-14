// The tab and pane model (C5 execution document, "Tab and pane transitions"; residue *Tab strip* and *Split*): pure
// functions over the strip, one per row of the transition table, so the table is testable without a store. At most two
// panes (D-8). The Overview is not a tab (W5, §5.2 as amended 2026-10-01): it floats over the main area, so the only
// pane may be empty. UX wave U13a (its section, "The strip"; it replaces W12's set per project): one strip for every tab
// open in the window, from every project and machine; a tab id exists once in it, since ids are computed from what a
// tab shows. `main.tabs` stores `storedMain` of it and is read back through `stripOf` (`@shared/ipc/schema/layout`).
import type { AppSessionId } from '@shared/graph/ids';
import { machineKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import {
  EMPTY_TAB_SET, NO_PROJECT, tabId, type PaneState, type ProjectKey, type Strip, type TabRef, type TabSet, type TabSetKey, type TabTarget,
} from '@shared/ipc/schema/layout';

type Pane = 0 | 1;
export type PaneTarget = Pane | 'focused' | 'other';
// What the transitions work on: the strip's panes, with its closed-tab history.
type View = Strip;

const CLOSED_MAX = 10;

const toRef = (target: TabTarget): TabRef => ({ ...target, id: tabId(target), pinned: false }) as TabRef;

// ---- the strip -------------------------------------------------------------------------------------------------------

// The strip as a tab set (the name stays for its readers: its panes, focus, ratio and float).
export const currentSet = (main: Strip): TabSet => main;

// Every tab of the strip, both panes (usage, the viewer's pruning, a close guard's lookup).
export const allTabs = (main: Strip): TabRef[] => main.panes.flatMap((p) => p.tabs);

// Where tab `id` is: its pane and index.
export const locateTab = (main: Strip, id: string): { pane: Pane; index: number } | null => locate(main, id);

export const isOpen = (main: Strip, id: string): boolean => locateTab(main, id) !== null;

// Runs a transition over the strip and normalises its float; an unchanged view leaves `main` as it was, so nothing is
// persisted for a no-op.
function onStrip(main: Strip, fn: (view: View) => View): Strip {
  const after = fn(main);
  if (after === main) return main;
  return { ...keptFloat(main, asSet(after)), closedTabs: after.closedTabs };
}

// P4-B3 (X37): a float belongs to the pane that collapsed. A transition that leaves its session tab active in the other
// pane (⌘\, "Open in split", a drag between the strips) docks the split rather than floating the pane beside it.
function keptFloat(before: TabSet, after: TabSet): TabSet {
  const was = floatingPane(before);
  const now = floatingPane(after);
  return was === null || now === null || was === now ? after : asSet({ ...after, floating: undefined });
}

// P4-B3 (X37; its Decision Log 6): the float is normalised rather than policed. The strip written back keeps `floating`
// only while it names the active session tab of one of two panes, so every transition docks a float its change ended:
// A's last tab closing (one pane, S full width), S's tab closing or changing (docked at the ratio, or A alone), the
// session removed; `keptFloat` adds S's tab leaving its pane.
const asSet = ({ panes, focusedPane, splitRatio, floating }: TabSet): TabSet => {
  const set: TabSet = { panes, focusedPane, splitRatio };
  if (!floating || floatingPane({ ...set, floating }) === null) return set;
  return { ...set, floating: floating.foldedPanel ? { sessionTabId: floating.sessionTabId, foldedPanel: true } : { sessionTabId: floating.sessionTabId } };
};

// ---- reading the strip -------------------------------------------------------------------------------------------------

// The pane at an index the caller knows exists (the focused pane, or one `locate` found).
const paneAt = (view: TabSet, pane: Pane): PaneState => view.panes[pane] as PaneState;

// P4-B3 (X37): the pane that has yielded into the floating card: the one whose active tab is the strip's floating session
// tab, while it has two panes; null while docked.
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

// The active tab of the strip's focused pane: what the toolbar titles and the right panel follows.
export function activeTab(main: Strip): TabRef | null {
  const pane = main.panes[main.focusedPane] ?? main.panes[0];
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
// split: the tab goes into it (pane 0 is never left empty beside pane 1). Activated, the tab's pane takes the focus; in
// the background (U13a, §B) the focus stays where it was.
function place(view: View, tab: TabRef, pane: Pane, index: number | 'afterActive', activate: boolean): View {
  const panes = [...view.panes] as PaneState[];
  if (pane === 1 && panes.length === 1 && panes[0].tabs.length === 0) return place(view, tab, 0, index, activate);
  if (pane === 1 && panes.length === 1) {
    return { ...view, panes: [panes[0], { tabs: [tab], activeTabId: tab.id }], focusedPane: activate ? 1 : view.focusedPane, splitRatio: 0.5 };
  }
  const target = panes[pane];
  const at = index === 'afterActive' ? target.tabs.findIndex((t) => t.id === target.activeTabId) + 1 : index;
  panes[pane] = insertAt(target, tab, at, activate);
  return { ...view, panes: panes as TabSet['panes'], focusedPane: activate ? pane : view.focusedPane };
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
    // A file tab is one tab per path whatever its line or session: opening it again takes the line and the session (null
    // included) of this open, keeping its pin, so the right panel follows the session that last opened it (C8's tenth
    // ask). (UX wave U7b: the Settings and Customize tabs, which moved to the section asked for, retired.)
    const open = paneAt(view, found.pane).tabs[found.index];
    const updated =
      target.kind === 'file' && open.kind === 'file'
        ? replaceTab(view, found.pane, found.index, { ...open, line: target.line, appSessionId: target.appSessionId })
        : view;
    return activate ? activateIn(updated, tabId(target)) : updated;
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

// Brings an open tab to the front, or adds it after the tab in front of the pane asked for. With `activate: false`
// (U13a, §B) no pane's focus and no pane's active tab changes: an open tab takes only its kind's update, and a new one
// is active only in a pane that was empty.
export function openTab(main: Strip, target: TabTarget, opts: { pane?: PaneTarget; activate?: boolean } = {}): Strip {
  return onStrip(main, (v) => openIn(v, target, opts.pane ?? 'focused', opts.activate ?? true));
}

// How a session opens (I2, §5.2 as amended 2026-10-01): by default it takes the place of the focused pane's session
// (`replaceActive`); `how: 'tab'` gives it a tab of its own (⌘-click, middle-click, "Open in new tab", a fork); `split`
// opens it in the other pane ("Open in split", ⌘Enter), an already open session moving there.
export interface OpenSessionOptions {
  split?: boolean;
  how?: 'replace' | 'tab';
}

export function openSession(main: Strip, appSessionId: AppSessionId, opts: OpenSessionOptions = {}): Strip {
  const target: TabTarget = { kind: 'session', appSessionId };
  if (!opts.split) return opts.how === 'tab' ? openTab(main, target) : replaceActive(main, appSessionId);
  return onStrip(main, (v) => {
    const at = locate(v, tabId(target));
    const other = paneOf(v, 'other');
    if (!at) return openIn(v, target, other, true);
    if (v.panes.length === 2 && at.pane === other) return activateIn(v, tabId(target));
    const dest: Pane = v.panes.length === 2 ? other : 1;
    return moveIn(v, tabId(target), dest, v.panes[dest]?.tabs.length ?? 0);
  });
}

// I2: a session opened from the sidebar, the Overview or the palette replaces what the focused pane shows. Open already,
// it is activated; otherwise an unpinned tab active in the focused pane, of any kind (E11 F2b, plan 2.5; owner decision
// 2), whatever project or machine it is of, gives its place to it under the session's own tab id, the old ref joining
// the closed-tab history for ⌘⇧T; a pinned tab or an empty pane is left alone and the session opens after it. A tab
// whose work replacing it would lose (an unsaved file, a launch in flight, a blank unstarted chat) is the store's to
// keep out of this (it asks for a tab of its own).
export function replaceActive(main: Strip, appSessionId: AppSessionId): Strip {
  const target: TabTarget = { kind: 'session', appSessionId };
  if (isOpen(main, tabId(target))) return openTab(main, target);
  const old = activeTab(main);
  if (old === null || old.pinned) return openTab(main, target);
  return onStrip(main, (v) => {
    const at = locate(v, old.id) as { pane: Pane; index: number };
    const tab = toRef(target);
    const panes = [...v.panes] as PaneState[];
    panes[at.pane] = { tabs: panes[at.pane].tabs.map((t) => (t.id === old.id ? tab : t)), activeTabId: tab.id };
    return { ...v, panes: panes as TabSet['panes'], closedTabs: [...v.closedTabs.filter((t) => t.id !== old.id), old].slice(-CLOSED_MAX) };
  });
}

// cua #90: tab `id` shows `target` from now on, in its place, with its pin and its being active (an options tab main
// replaced with a page: the tab it showed is gone, so nothing joins the closed-tab history); the focus stays. A tab not
// open, or a target open already (an id lives once), leaves the strip as it was.
export function retargetTab(main: Strip, id: string, target: TabTarget): Strip {
  const found = locateTab(main, id);
  if (!found || isOpen(main, tabId(target))) return main;
  return onStrip(main, (v) => {
    const pane = paneAt(v, found.pane);
    const tab = { ...toRef(target), pinned: pane.tabs[found.index].pinned } as TabRef;
    const retargeted = replaceTab(v, found.pane, found.index, tab);
    if (pane.activeTabId !== id) return retargeted;
    const panes = [...retargeted.panes] as PaneState[];
    panes[found.pane] = { ...panes[found.pane], activeTabId: tab.id };
    return { ...retargeted, panes: panes as TabSet['panes'] };
  });
}

export const activateTab = (main: Strip, id: string): Strip => onStrip(main, (v) => activateIn(v, id));

export function focusPane(main: Strip, pane: Pane): Strip {
  return onStrip(main, (v) => (pane < v.panes.length && pane !== v.focusedPane ? { ...v, focusedPane: pane } : v));
}

// `remember: false` (P4-B3, its Decision Log 32): a move is not a close, so the tab leaves no ⌘⇧T entry.
export interface CloseOptions {
  remember?: boolean;
}
export const closeTab = (main: Strip, id: string, opts: CloseOptions = {}): Strip => onStrip(main, (v) => closeIn(v, id, opts.remember ?? true));

export const moveTab = (main: Strip, id: string, toPane: Pane, index: number): Strip => onStrip(main, (v) => moveIn(v, id, toPane, index));

export function splitWithActive(main: Strip): Strip {
  return onStrip(main, (v) => {
    const pane = paneAt(v, v.focusedPane);
    if (v.panes.length === 1 && pane.tabs.length < 2) return v;
    const to: Pane = v.panes.length === 2 ? ((1 - v.focusedPane) as Pane) : 1;
    return moveIn(v, pane.activeTabId, to, v.panes[to]?.tabs.length ?? 0);
  });
}

export function selectTab(main: Strip, n: number): Strip {
  return onStrip(main, (v) => {
    const tab = paneAt(v, v.focusedPane).tabs[n - 1];
    return tab ? activateIn(v, tab.id) : v;
  });
}

export function cycleTab(main: Strip, delta: 1 | -1): Strip {
  return onStrip(main, (v) => {
    const { tabs, activeTabId } = paneAt(v, v.focusedPane);
    if (tabs.length === 0) return v;
    const at = tabs.findIndex((t) => t.id === activeTabId);
    return activateIn(v, tabs[(at + delta + tabs.length) % tabs.length].id);
  });
}

// `at` is where the tab stood when it was closed, when the store remembers it; otherwise it opens like any tab.
export function reopenClosed(main: Strip, at: number | null): Strip {
  const tab = main.closedTabs.at(-1);
  if (!tab) return main;
  const rest = { ...main, closedTabs: main.closedTabs.slice(0, -1) };
  if (isOpen(rest, tab.id)) return activateTab(rest, tab.id);
  return onStrip(rest, (v) => place(v, tab, v.focusedPane, at ?? 'afterActive', true));
}

export function togglePinned(main: Strip, id: string): Strip {
  const found = locateTab(main, id);
  if (!found) return main;
  return onStrip(main, (v) => {
    const panes = [...v.panes] as PaneState[];
    const pane = panes[found.pane];
    panes[found.pane] = { ...pane, tabs: pinnedFirst(pane.tabs.map((t) => (t.id === id ? ({ ...t, pinned: !t.pinned } as TabRef) : t))) };
    return { ...v, panes: panes as TabSet['panes'] };
  });
}

const belongsTo = (tab: TabRef, appSessionId: AppSessionId) => (tab.kind === 'session' || tab.kind === 'agent') && tab.appSessionId === appSessionId;

// `session.removed`: the session's session and agent tabs close without a closed-tab entry; it cannot be reopened.
export function dropSession(main: Strip, appSessionId: AppSessionId): Strip {
  const next = onStrip(main, (v) => {
    const gone = v.panes.flatMap((p) => p.tabs).filter((t) => belongsTo(t, appSessionId));
    if (gone.length === 0) return v;
    return withPanes(v, v.panes.map((p) => gone.reduce((pane, t) => without(pane, t.id), p)), v.focusedPane);
  });
  const closedTabs = next.closedTabs.filter((t) => !belongsTo(t, appSessionId));
  return closedTabs.length === next.closedTabs.length ? next : { ...next, closedTabs };
}

// P4-B3 (its Decision Log 3): the pixel floors are the divider's and the render's (`main/split.ts`), so the model only
// keeps the ratio sane.
export function setSplitRatio(main: Strip, ratio: number): Strip {
  const splitRatio = Number.isFinite(ratio) ? Math.min(0.99, Math.max(0.01, ratio)) : 0.5;
  return onStrip(main, (v) => ({ ...v, splitRatio }));
}

// P4-B3 (X37; its Decision Log 1, 2, 4): the strip's pane showing session tab `sessionTabId` yields into the floating
// card; `splitRatio` is left as it was, so Dock returns the ratio at pointer-down. Nothing changes unless the strip is a
// split with that session tab active in a pane. P4-B3x: `foldedPanel` marks the float as Expand's with the right panel
// folded by it (the layout store folds the panel in the same change).
export function floatSplit(main: Strip, sessionTabId: string, opts: { foldedPanel?: boolean } = {}): Strip {
  return onStrip(main, (v) => {
    if (v.floating?.sessionTabId === sessionTabId) return v;
    const next: View = { ...v, floating: opts.foldedPanel ? { sessionTabId, foldedPanel: true } : { sessionTabId } };
    return floatingPane(next) === null ? v : next;
  });
}

// P4-B3x (P4 Decision Log 40): the float whose Expand folded the right panel; null when no fold stands. A fold is made
// only over an open panel and dropped whenever the panel opens.
export function foldOf(main: Strip): { sessionTabId: string } | null {
  return main.floating?.foldedPanel ? { sessionTabId: main.floating.sessionTabId } : null;
}

// Whether the fold standing in `before` ended with its float in `after` (a dock, Restore split, or any transition that
// ended the float), rather than by the mark being dropped while the float stays.
export function foldEnded(before: Strip, after: Strip): boolean {
  const fold = foldOf(before);
  return fold !== null && after.floating?.sessionTabId !== fold.sessionTabId;
}

// The fold mark dropped, the float kept (the owner opened the panel: leaving Expand then leaves it as they set it);
// `main` itself when none stands.
export function unfold(main: Strip): Strip {
  const fold = foldOf(main);
  return fold === null ? main : { ...main, floating: { sessionTabId: fold.sessionTabId } };
}

// The floating pane comes back beside the other at the stored ratio; `floating` goes from the value.
export function dockSplit(main: Strip): Strip {
  return onStrip(main, (v) => (v.floating ? { ...v, floating: undefined } : v));
}

// P5 O6 M2 (M6's scene): each session tab takes its session's title where `titleOf` knows one that differs from the
// title the tab holds; a session it does not know keeps the title its tab last knew. Nothing differs: `main` itself.
export function titleTabs(main: Strip, titleOf: (appSessionId: AppSessionId) => string | undefined): Strip {
  let changed = false;
  const panes = main.panes.map((pane) => {
    let paneChanged = false;
    const tabs = pane.tabs.map((tab) => {
      if (tab.kind !== 'session') return tab;
      const title = titleOf(tab.appSessionId);
      if (title === undefined || title === tab.title) return tab;
      paneChanged = true;
      return { ...tab, title };
    });
    if (!paneChanged) return pane;
    changed = true;
    return { ...pane, tabs };
  }) as TabSet['panes'];
  return changed ? { ...main, panes } : main;
}

// ---- P5 O6 M5: project keys to org keys --------------------------------------------------------------------------------
// (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "Migrating project-keyed state".) A project key that is
// an address is from before M5: an org key is never one (its prefix holds a `:`, which a `MachineRef` cannot), so a key
// still an address is still to migrate, which makes the migration resumable with no version, across machines that load
// late. `RekeyOf` answers for an address key what it becomes: the key its project's sessions file under now, 'gone' when
// its machine has loaded and no longer has the project, or 'wait' while its machine's projects (or the project's key)
// are not known; an address that is what its project files under now answers itself.
// The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J.2; design §2, "the second's
// set is moved whole into the first's"): it is asked of every other project key too, neither a machine's row nor the
// no-project set, and answers the key that entry belongs under now: itself while it is a row's, else its successor
// (`stores/org-projects.ts`'s `successorOf`); 'wait' while it can't say. Such a key is never 'gone': with no successor it
// stays, as a hidden project's set does.
export type RekeyOf = (key: TabSetKey) => TabSetKey | 'gone' | 'wait';

// The keys `RekeyOf` is asked of: a project's address, an org project's key; never a machine's row or the no-project set.
const isRekeyable = (key: string): key is TabSetKey => key !== NO_PROJECT && !key.startsWith('machine:');

// `regions.sidebar.expandedProjects`: an address entry to its org key, each once; one gone is dropped (an expanded
// state costs nothing to lose); a waiting one stays; `'other'` ("Other sessions") is this machine's own row now.
export function rekeyExpanded(list: readonly ProjectKey[], rekeyOf: RekeyOf, local: MachineRef): ProjectKey[] {
  const out: ProjectKey[] = [];
  for (const key of list) {
    const to = key === 'other' ? machineKey(local) : isRekeyable(key) ? rekeyOf(key) : key;
    const at = (to === 'wait' ? key : to) as ProjectKey | 'gone'; // a row's key is never the no-project set's
    if (at !== 'gone' && !out.includes(at)) out.push(at);
  }
  return out;
}

// Hydration: a session or agent tab whose record no longer exists is dropped silently, a tab id exists once in the
// strip (its first copy kept), pinned tabs precede the rest, every pane's active tab is one of its tabs, and a strip
// left with nothing is one empty pane.
export function repairMain(main: Strip, known: (appSessionId: AppSessionId) => boolean): Strip {
  const keep = (t: TabRef) => (t.kind !== 'session' && t.kind !== 'agent') || known(t.appSessionId);
  const seen = new Set<string>();
  const panes = main.panes.map((p): PaneState => {
    const tabs = pinnedFirst(p.tabs.filter((t) => keep(t) && !seen.has(t.id) && seen.add(t.id)));
    return { tabs, activeTabId: tabs.some((t) => t.id === p.activeTabId) ? p.activeTabId : (tabs[0]?.id ?? '') };
  });
  return { ...asSet(withPanes(main, panes, main.focusedPane)), closedTabs: main.closedTabs.filter(keep) };
}
