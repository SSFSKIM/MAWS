// The layout store (C5 execution document, Renderer stores; §4.1: layout state lives in the renderer, persistence is
// main's through `layout.*`). The four persisted keys plus transient drag and focus state. The tab and pane transitions
// are the pure functions of `layout-model.ts`; this store holds their result. Hydration reads each key, validates it
// against C5's shapes (an absent or invalid value falls back to its default) and repairs `main.tabs` against the
// sessions that exist. `persistLayout` writes each changed key back through `layout.set`, 250 ms after its last change
// and on `beforeunload`. UX wave U13a (its section, "The strip"; the plan's Interfaces §B and §C): the store holds one
// strip for every tab open in the window, written to `main.tabs` as `storedMain` of it and read back through `stripOf`,
// which merges the sets a value from before it holds (W12's set per project).
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import {
  CARD_IDS,
  CARDS_OPEN_DEFAULT,
  CardsOpenSchema,
  LAYOUT_DEFAULTS,
  NO_PROJECT,
  PANEL_GROUPS_DEFAULT,
  PanelGroupsSchema,
  PanelWidthsSchema,
  PanelActiveNoSessionSchema,
  PanelParamsSchema,
  PanelPinnedSchema,
  MAIN_CARD_PREFIX,
  pageAtStart,
  PanelSessionStateSchema,
  StoredDestinationSchema,
  storedMain,
  storedMainSchema,
  storedPanelSurfacesSchema,
  storedRegionsSchema,
  stripOf,
  type CardId,
  type Destination,
  type FloatingCardSize,
  type LayoutKey,
  type LayoutMain,
  type LayoutMainV1,
  type LayoutRegions,
  type PanelGroups,
  type PanelSessionState,
  type PanelSurfaces,
  type PanelWidths,
  type PanelTabRef,
  type Strip,
  type TabRef,
  type TabTarget,
} from '@shared/ipc/schema/layout';
import { addressOf, isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type * as z from 'zod';
import * as model from './layout-model';
import { rememberSurfaceContext, surfaceRefs, surfaceScope, surfaceSession, surfaceTabs } from '../panel/surface-model';
import { clampShare, groupOf, joinLower, repairScope, scopeValues, sideGroups, valuesOf, type ScopeValues, type SideGroup, type SideGroupName, type SideGroups } from '../panel/surface-model'; // UX wave U8b
import { isWideColumn } from '../app/shell-geometry'; // UX wave U8b
import type { SettingsSection } from '../settings-tab/SettingsView'; // UX wave U7b: a type only, so no view loads with the store

type Pane = 0 | 1;

export interface LayoutState {
  regions: LayoutRegions;
  main: Strip;
  panelPinned: PanelTabRef[];
  panelBySession: Map<AppSessionId, PanelSessionState>;
  // The selected panel tab while no session is in view, when only the pins show; always a pin's id or null. A session's
  // own selection persists in `panel.<appSessionId>`; this one in `panelTools.activeNoSession` (P4-B3: it was transient,
  // so a pinned tab selected with no session came back as the Session overview at a relaunch).
  panelActiveNoSession: string | null;
  // P4-B3 (its Decision Log 22; X5 as amended): what each panel tool persisted of a tab, by panel tab id
  // (`panelTools.params`), handed back as the restored instance's `init.params`.
  panelParams: Record<string, unknown>;
  panelSurfaces: PanelSurfaces;
  // UX wave U8b (its execution document, Interfaces §A and §B): the lower group of each scope that has one
  // (`panelTools.groups`), the side column's two remembered widths (`panelTools.widths`), and the open folding cards
  // (`cards.open`).
  panelGroups: PanelGroups;
  panelWidths: PanelWidths;
  cardsOpen: CardId[];
  // UX wave U8b (Decision Log 3): the profile's first read was deferred (a read failed) and this build has not yet written
  // the side column's state; persistence's first such write also writes `panelTools.groups`, which ends it (transient).
  firstReadPending: boolean;
  // Hydration's live record/intent resolver; derivation ignores stale contexts without deleting saved preferences.
  knownSession(appSessionId: AppSessionId): boolean;
  hydrated: boolean;
  // The tab being dragged (P4-B3, X38; its Decision Log 16): a main tab, or a panel tab showing an artifact's record.
  // Transient; the drop targets decide acceptance from it (`shell/transfer.ts`).
  dragging: { source: 'main'; tabId: string; fromPane: Pane } | { source: 'panel'; tabId: string; toolId: string; artifactId: string } | null;
  // W5: whether the floating Overview is open (transient: the app opens to the last active tab, §5.2 as amended); its
  // rect persists in `regions.overview`.
  overviewOpen: boolean;
  // UX wave U7b (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, Interfaces §F; the wave's
  // UC-12): the page open beside the sidebar in place of the tabs (stored under `destination`), and the Settings dialog
  // (never stored, as the Overview is not). Each is apart from the strip: opening or closing either leaves `main` as it
  // is, and every act that brings a tab to the front (`commitShown`) closes both in the write that lands it.
  destination: Destination | null;
  settings: { section: SettingsSection | null } | null;
  openDestination(target: Destination): void; // replaces an open one; the same kind again changes only its fields; closes the dialog
  closeDestination(): void;
  openSettings(section?: SettingsSection): void; // over the tabs or a page; open already: only a section that is given changes
  closeSettings(): void;
  closeFront(): boolean; // ⌘W: the dialog if it is open, else the page; false when neither was
  // `settle` runs once the reads are in, before `known` is first asked and the early changes are captured (debt wave 5:
  // the shell drains its batched record events there, and the removals that makes are replayed with the rest).
  // P5 O6 M5: `rekeyOf` answers what a project key from before M5 (a project's address) becomes (`model.RekeyOf`); every
  // expanded row keyed by one migrates at hydration and again at `rekeyProjects`.
  // P5 O6 M2 (M6's scene): `titleOf` answers a held session's title, which its tabs keep (`refreshTabTitles`).
  // U13a: `merged` is `stripOf`'s, a stored value whose sets were merged into the strip (the upgrade's notice).
  // UX wave U8b: `multiInstance` answers whether a tool takes several tabs (undefined: not registered now), which the
  // first read of a profile (no `panelTools.groups` yet) needs to drop the tabs that were never closed (Interfaces §A).
  hydrate(client: MawsBridge, known: (appSessionId: AppSessionId) => boolean, opts?: { settle?: () => void; rekeyOf?: model.RekeyOf; titleOf?: TitleOf; multiInstance?: (toolId: string) => boolean | undefined }): Promise<{ merged: boolean }>;
  openTab(ref: TabTarget, opts?: { pane?: model.PaneTarget; activate?: boolean }): void;
  // I2: replaces the focused pane's session unless `how: 'tab'` or `split` asks otherwise (`model.openSession`).
  openSession(appSessionId: AppSessionId, opts?: model.OpenSessionOptions): void;
  // P5 O6 M2 (M6's scene): session tabs take their sessions' titles where they differ (the shell calls it when records
  // change); nothing differs, nothing changes, so nothing is written.
  refreshTabTitles(): void;
  // P5 O6 M5 ("Migrating project-keyed state"): the sidebar's expanded rows still keyed from before M5 migrate, as far as
  // `rekeyOf` now knows (the shell calls it when a machine's projects arrive). Before hydration, nothing: hydration
  // migrates what it reads.
  rekeyProjects(): void;
  closeTab(id: string, opts?: model.CloseOptions): void; // P4-B3: `remember: false` for a move (no ⌘⇧T entry)
  retargetTab(id: string, target: TabTarget): void; // cua #90: `model.retargetTab`
  reopenClosed(): void;
  moveTab(id: string, toPane: Pane, index: number): void;
  reorderTab(id: string, index: number): void;
  selectTab(n: number): void;
  cycleTab(delta: 1 | -1): void;
  activateTab(id: string): void;
  togglePinned(id: string): void;
  splitWithActive(): void;
  // U13a (rule 7; the plan's §C): `focusPane` follows where the keyboard or a press already is (a pane's focus and
  // pointer capture, the compact composer, a pane's own cycle); `showPane` is a pane the person chose (`pane.focusOther`,
  // the split card's float, dock, open and close). They make the same change of the strip; only `showPane` is an act
  // that shows the tabs (`commitShown`).
  focusPane(i: Pane): void;
  showPane(i: Pane): void;
  setSplitRatio(r: number): void;
  // P4-B3 (X37): the split's float, `model.floatSplit` / `model.dockSplit`. P4-B3x: `foldPanel`
  // (Expand's) also folds an open right panel in the same change, marking the float as its fold (`reconcileFold`).
  floatSplit(sessionTabId: string, opts?: { foldPanel?: boolean }): void;
  dockSplit(): void;
  dropSession(appSessionId: AppSessionId): void; // session.removed
  // P5 O6 M4 ("The layout across machines"): run after the first snapshot of each of a machine's link generations. The
  // machine's tabs and panel states whose session `knownSession` (hydration's) no longer knows go, as hydration drops a
  // local one's: what that machine does not list, unless the registered retention keeps it. Before hydration, nothing:
  // hydration judges every tab against what is known then.
  settleMachine(machine: MachineRef): void;
  // A patch, or an updater for a change that depends on the sidebar it lands on (an early one is replayed over the
  // hydrated value, not the default it was made against).
  setSidebar(patch: Partial<LayoutRegions['sidebar']> | ((sidebar: LayoutRegions['sidebar']) => Partial<LayoutRegions['sidebar']>)): void;
  // P3-G (§D1.1): every writer of the panel's state comes here, which keeps `floating` and `maximized` exclusive and both
  // off while collapsed (`panelAfter`).
  setPanel(patch: Partial<LayoutRegions['panel']>): void;
  // P3-G (§D1.2): brings the main area back, a maximized or floating panel docking (the Overview opening over main,
  // attention navigation showing a session's pane).
  revealMain(): void;
  // P3-G (§D1.5): the floating card's size over a panel tab (its id, or 'summary'), or (P4-B3) the split card's over a
  // main tab (`mainCardKey`); entries of tabs no longer open in a panel list or in main are dropped and at most
  // FLOATING_CARD_SIZES_MAX kept, the oldest first out.
  setFloatingCardSize(key: string, size: FloatingCardSize): void;
  setOverviewOpen(open: boolean): void;
  setOverviewRect(rect: LayoutRegions['overview']): void;
  setPanelTabPinned(appSessionId: AppSessionId, tabId: string, pinned: boolean): void;
  // The panel host's `onChange` (PanelHostProps): pinned refs go to `panel.pinned` (D-10), the rest to the session's own
  // key; with no session only the pins are kept. UX wave U8b (M2): maintenance of the refs only. `next.tabs` is the
  // scope's whole list and `next.activeTabId` is not read: what is in view changes by `showSurfaceTab` and its kin alone,
  // and every scope the change reaches is repaired (`repairScope`).
  // M3: `opts.group` 'lower' places the refs the write adds in the writer's lower group, when its scope has one.
  setPanelTabs(appSessionId: AppSessionId | null, next: PanelSessionState, opts?: { group?: SideGroupName }): void;
  toggleSurfacePin(toolId: string): void; // the icon-row preference, separate from keep-across-session tab pins
  effectivePanelTabs(appSessionId: AppSessionId | null): PanelTabRef[]; // panelPinned first, then the session's own
  // A session's panel refs whichever session or the Overview is on screen (C8's eleventh ask: C10's Attach adds a
  // Terminal tab to session A from a sidebar row while B is shown). Read as the host reads them (the pins first) and
  // written as `setPanelTabs` splits them: pinned refs to `panel.pinned`, the rest to `panel.<appSessionId>`. UX wave
  // U8b (M2, decision 2): the refs are maintained as `setPanelTabs` maintains them (`opts.group` passed on, M3), then
  // `opts.activate`, when given, comes into view (`showSurfaceTab`); without it nothing in view changes and a hidden
  // column stays hidden.
  panelTabsOf(appSessionId: AppSessionId): PanelTabRef[];
  updatePanelTabs(appSessionId: AppSessionId, fn: (refs: PanelTabRef[]) => PanelTabRef[], opts?: { activate?: string; group?: SideGroupName }): void;
  // P4-B3 (Decision Log 22): a tool's persistable params for one of its tabs, null clearing them. Every write keeps only
  // the params of panel tabs some list holds, and the tab written (whose instance exists before its ref is written).
  setPanelParams(tabId: string, params: unknown): void;
  setDragging(dragging: LayoutState['dragging']): void;
  // UX wave U8b (Interfaces §B): the acts that change what the side column has in view, these and only these. Each reads
  // the scope through `sideGroups` and writes `stacks`, the selection and the lower entry together.
  showSurfaceTab(appSessionId: AppSessionId | null, tabId: string): void; // in view in its own group; a hidden column is shown, each group with its remembered tab
  hideSurfaces(appSessionId: AppSessionId | null): void; // stacks[scope] = []; the selection and the lower entry kept
  moveSurfaceTab(appSessionId: AppSessionId | null, tabId: string, to: 'upper' | 'lower'): void;
  setGroupShare(appSessionId: AppSessionId | null, share: number): void; // clamped to 0.2..0.8
  setPanelWidth(px: number | null): void; // the width in use (wide or narrow) and regions.panel.width; null: automatic again
  setCardOpen(card: CardId, open: boolean): void;
}

const PANEL_KEY = /^panel\.([^.]+)$/;
const NO_SURFACES: PanelSurfaces = { version: 2, stacks: {}, pinnedTools: [], contexts: {} };

const WAIT: model.RekeyOf = () => 'wait';
// P5 O6 M2: a held session's title, undefined for a session the page does not hold
export type TitleOf = (appSessionId: AppSessionId) => string | undefined;

// I2: an unstarted tab a replace would take the place of is not replaced: the session opens beside it, then the tab
// passes C10's close guard (it asks only about a non-empty draft) and goes with its intent, or stays when declined
// (`openSession`). The action runtime, which owns the guards, registers this (`registerShellActions`); unregistered,
// every unpinned tab is replaced alike.
export interface ReplaceGuard {
  unstarted(appSessionId: AppSessionId): boolean;
  discard(tab: TabRef): Promise<boolean>;
  // E11 F2b (plan 2.5; owner decision 2): what replacing the shown tab would cost (`ReplaceVerdict`), asked of every
  // unpinned tab a replace would take the place of; `announce` tells the owner why a tab stayed or where its work went.
  // A blank unstarted chat answers null and goes the way above.
  verdict?(tab: TabRef): ReplaceVerdict;
  announce?(tab: TabRef, verdict: NonNullable<ReplaceVerdict>): void;
}

// null: nothing is lost, the tab gives its place (a blank unstarted chat: discarded, as above). `keep`: it stays open
// and the session opens beside it (an unsaved or saving file, a launch in flight), `keep` saying why. `aside`: it leaves
// the strip with its work kept to come back to (an unstarted chat's draft, with its intent; ⌘⇧T reopens it).
export type ReplaceVerdict = { keep: string } | { aside: string } | null;

let replaceGuard: ReplaceGuard | null = null;

export function registerReplaceGuard(guard: ReplaceGuard): () => void {
  replaceGuard = guard;
  return () => {
    if (replaceGuard === guard) replaceGuard = null;
  };
}

// P3-G (§D1.1): the panel after a patch. Collapsing clears both maximized and floating; floating or maximizing clears
// the other and shows a collapsed panel (the action table's transitions, §D1.2).
type PanelRegionState = LayoutRegions['panel'];
export function panelAfter(panel: PanelRegionState, patch: Partial<PanelRegionState>): PanelRegionState {
  const next = { ...panel, ...patch };
  if (patch.collapsed === true) return { ...next, maximized: false, floating: false };
  if (patch.floating === true) return { ...next, collapsed: false, maximized: false };
  if (patch.maximized === true) return { ...next, collapsed: false, floating: false };
  return next;
}

// P4-B3x (P4 Decision Log 40): the fold rule between `main` and `regions`, applied to every change of either and at
// hydration. Expand folds an open right panel with its float (`floatSplit`'s `foldPanel`), the fold marked on the float
// (`floating.foldedPanel`). The mark stands only while the panel stays folded: the panel opening by any path (its
// toggle, Maximize, Float, a tool revealing it) drops it, so leaving Expand then leaves the panel as the owner set it;
// the float ending by any path (Restore split, the card's Dock, ⌥⌘B docking the split card, A's last tab closing, S's
// tab leaving its pane) opens the panel the fold closed, as it was: the same region, its width, tools and tabs kept.
export function reconcileFold(before: Strip, next: Pick<LayoutState, 'main' | 'regions'>): Pick<LayoutState, 'main' | 'regions'> {
  if (!next.regions.panel.collapsed) {
    const main = model.unfold(next.main);
    return main === next.main ? next : { main, regions: next.regions };
  }
  if (!model.foldEnded(before, next.main)) return next;
  return { main: next.main, regions: { ...next.regions, panel: panelAfter(next.regions.panel, { collapsed: false }) } };
}

// U13a (the plan's §B): the id of the tab in front, the active tab of the focused pane; '' while that pane is empty.
export const frontOf = (state: Pick<LayoutState, 'main'>): string => model.activeTab(state.main)?.id ?? '';

// ---- UX wave U7b: the page and the dialog (its execution document, Interfaces §F and §N) -------------------------------

/** The logical answer the readers of §N ask: a page is open, so nothing behind it is on screen. It decides the size of nothing and unmounts nothing a page hides: what is hidden stays mounted at its box (M5, decision 2). */
export const pageOpen = (state: Pick<LayoutState, 'destination'>): boolean => state.destination !== null;

/** What the person is looking at: 'settings', 'page:<kind>', or `frontOf(state)`. */
export function placeOf(state: Pick<LayoutState, 'main' | 'destination' | 'settings'>): string {
  if (state.settings !== null) return 'settings';
  if (state.destination !== null) return `page:${state.destination.kind}`;
  return frontOf(state);
}

/** The tab an act of the person's applies to when the act shows nothing: the tab in front, or null while a page covers it (§N, the second table). */
export const tabOnScreen = (state: Pick<LayoutState, 'main' | 'destination'>): TabRef | null => (pageOpen(state) ? null : (model.activeTab(state.main) ?? null));

// The side column docked: neither maximized nor floating, its width and collapsed as they were.
const docked = (r: LayoutRegions): LayoutRegions => (r.panel.maximized || r.panel.floating ? { ...r, panel: { ...r.panel, maximized: false, floating: false } } : r);

let quiet = 0;
/** Runs `run` as something that is not the person's act: a tab it brings to the front closes neither the page nor the dialog. It holds only for what runs synchronously inside it. */
export function quietly<T>(run: () => T): T {
  quiet += 1;
  try {
    return run();
  } finally {
    quiet -= 1;
  }
}

// A fold a stored value holds in any of its sets (P4-B3x): `stripOf` keeps only the float of the set that was showing,
// so a fold made in another set before U13a ends with its float there.
function storedFold(stored: LayoutMain | LayoutMainV1): { sessionTabId: string } | null {
  if (stored.version === 1) return null;
  for (const set of Object.values(stored.sets)) if (set?.floating?.foldedPanel) return { sessionTabId: set.floating.sessionTabId };
  return null;
}

export const FLOATING_CARD_SIZES_MAX = 64;
// The panel tab key of the resting summary (no tab selected), in `regions.floatingCard`.
export const SUMMARY_CARD_KEY = 'summary';
// P4-B3 (its Decision Log 10): the key of the split card's size over a main tab (the pane beside the card), pruned with
// the open main tabs as a panel tab's key is with the panel lists.
export const mainCardKey = (tabId: string): string => `${MAIN_CARD_PREFIX}${tabId}`;

const samePins = (a: PanelTabRef[], b: PanelTabRef[]) =>
  a.length === b.length && a.every((t, i) => t.id === b[i].id && t.toolId === b[i].toolId && t.pinned === b[i].pinned);

// Two JSON values alike, whatever order their keys were written in (a key holding undefined counts as absent, as JSON
// drops it): what the reader made of a stored value against the value itself, and a tool's params against those held.
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((v, i) => sameJson(v, (b as unknown[])[i]));
  const keys = (o: object) => Object.entries(o).filter(([, v]) => v !== undefined);
  const left = keys(a);
  const right = new Map(keys(b));
  return left.length === right.size && left.every(([k, v]) => right.has(k) && sameJson(v, right.get(k)));
}

// The panel tab ids some list holds: the pins and every session's own tabs.
const livePanelTabIds = (pinned: PanelTabRef[], bySession: Map<AppSessionId, PanelSessionState>): Set<string> =>
  new Set([...pinned.map((t) => t.id), ...[...bySession.values()].flatMap((s) => s.tabs.map((t) => t.id))]);

// A panel selection once its tabs go from `before` to `after` (the pins, for the no-session selection): the requested
// id if it is still there, else the current one if it is, else the tab that took the removed one's place (the next
// surviving tab to its right, or the last one), else null.
export function pinSelection(before: PanelTabRef[], after: PanelTabRef[], current: string | null, requested: string | null = current): string | null {
  const isPin = (id: string | null) => id !== null && after.some((t) => t.id === id);
  if (isPin(requested)) return requested;
  if (isPin(current)) return current;
  if (current === null || after.length === 0) return null;
  const right = before.slice(before.findIndex((t) => t.id === current) + 1).find((t) => isPin(t.id));
  return right?.id ?? after[after.length - 1].id;
}

// A summary is no longer a panel surface. If the current context has no tool to show, main keeps its place;
// hidden refs, params and sizing preferences remain available when that surface is opened again.
function surfaceRegions(state: LayoutState): LayoutRegions {
  const { regions } = state;
  if (!state.hydrated || (!regions.panel.floating && !regions.panel.maximized) || surfaceTabs(state, surfaceSession(state)).length > 0) return regions;
  return { ...regions, panel: { ...regions.panel, floating: false, maximized: false } };
}

// ---- the side column's stored groups (UX wave U8b, docs/doperpowers/plans/2026-11-12-ux-wave-U8b-column-and-tabs.md) ----

// Build F's automatic width, which `regions.panel.width` holds while this build's width in use is automatic (Interfaces §G).
export const F_AUTOMATIC_WIDTH = LAYOUT_DEFAULTS.regions.panel.width;
export const PANEL_WIDTHS_DEFAULT: PanelWidths = { version: 1, wide: null, narrow: null };
// The class of the side column's width now: wide while a tool of `WIDE_SURFACES` is among the tabs in view (`shellGeometryOf`).
export const panelWidthClass = (state: Pick<LayoutState, 'main' | 'knownSession' | 'panelPinned' | 'panelBySession' | 'panelActiveNoSession' | 'panelSurfaces'>): 'wide' | 'narrow' =>
  isWideColumn(surfaceTabs(state, surfaceSession(state))) ? 'wide' : 'narrow';

type Scoped = Pick<LayoutState, 'panelPinned' | 'panelBySession' | 'panelActiveNoSession' | 'panelSurfaces' | 'panelGroups'>;
type ScopePatch = Pick<LayoutState, 'panelBySession' | 'panelActiveNoSession' | 'panelGroups'> & { stacks: Record<string, string[] | undefined> };

const sameRefs = (a: readonly PanelTabRef[], b: readonly PanelTabRef[]) =>
  a.length === b.length && a.every((t, i) => t.id === b[i].id && t.toolId === b[i].toolId && t.pinned === b[i].pinned);

// The ids one write of a list replaced in place (the host's barrier gives a restored ref a new id where it stands): at a
// position of the writer's list, a ref of the same tool under an id the list did not hold, the old id gone from it.
function renamedIn(before: readonly PanelTabRef[], after: readonly PanelTabRef[]): Map<string, string> | undefined {
  if (before.length !== after.length) return undefined;
  const was = new Set(before.map((t) => t.id));
  const is = new Set(after.map((t) => t.id));
  const renamed = new Map<string, string>();
  before.forEach((tab, i) => {
    const next = after[i];
    if (tab.id !== next.id && tab.toolId === next.toolId && !is.has(tab.id) && !was.has(next.id)) renamed.set(tab.id, next.id);
  });
  return renamed.size > 0 ? renamed : undefined;
}

// Decision 7 of M1: `panelTools.groups` keeps the entries of scopes some list holds (`@none`, and each session with a list).
function liveGroups(lower: PanelGroups['lower'], bySession: ReadonlyMap<AppSessionId, PanelSessionState>): PanelGroups['lower'] {
  const kept = Object.entries(lower).filter(([scope]) => scope === surfaceScope(null) || bySession.has(scope as AppSessionId));
  return kept.length === Object.keys(lower).length ? lower : Object.fromEntries(kept);
}

// Writes scopes' values into a state: the stacks to set (undefined: the key removed), each selection, each lower entry.
function scopePatch(state: Scoped, entries: Iterable<[AppSessionId | null, ScopeValues]>): ScopePatch {
  let panelBySession = state.panelBySession;
  let panelActiveNoSession = state.panelActiveNoSession;
  let lower = state.panelGroups.lower;
  const stacks: Record<string, string[] | undefined> = {};
  for (const [session, values] of entries) {
    const scope = surfaceScope(session);
    const now = scopeValues(state, session);
    if (!sameJson(now.stack, values.stack)) stacks[scope] = values.stack;
    if (session === null) panelActiveNoSession = values.activeTabId;
    else if (now.activeTabId !== values.activeTabId || !panelBySession.has(session)) {
      if (panelBySession === state.panelBySession) panelBySession = new Map(panelBySession);
      const own = panelBySession.get(session) ?? { tabs: [], activeTabId: null };
      panelBySession.set(session, { ...own, activeTabId: values.activeTabId });
    }
    if (!sameJson(now.lower, values.lower)) {
      lower = { ...lower };
      if (values.lower === undefined) delete lower[scope];
      else lower[scope] = values.lower;
    }
  }
  lower = liveGroups(lower, panelBySession);
  const panelGroups = lower === state.panelGroups.lower ? state.panelGroups : { version: 1 as const, lower };
  return { stacks, panelBySession, panelActiveNoSession, panelGroups };
}

const withStacks = (surfaces: PanelSurfaces, stacks: Record<string, string[] | undefined>): PanelSurfaces => {
  if (Object.keys(stacks).length === 0) return surfaces;
  const next = { ...surfaces.stacks };
  for (const [scope, ids] of Object.entries(stacks)) {
    if (ids === undefined) delete next[scope];
    else next[scope] = ids;
  }
  return { ...surfaces, stacks: next };
};

// Decision 5 of M1: after a writer changed refs (`prev` to `next`), every scope whose refs changed has its values repaired
// (`repairScope`), each session with a list and `@none`; the writer's own scope among them (M2: no writer of refs sets
// what is in view).
function repairedScopes(prev: Scoped, next: Scoped, renamed?: ReadonlyMap<string, string>): [AppSessionId | null, ScopeValues][] {
  const repaired: [AppSessionId | null, ScopeValues][] = [];
  const pinsSame = prev.panelPinned === next.panelPinned || sameRefs(prev.panelPinned, next.panelPinned);
  for (const session of [null, ...next.panelBySession.keys()]) {
    const refs = surfaceRefs(next, session);
    const own = (s: Scoped) => (session === null ? undefined : s.panelBySession.get(session)?.tabs);
    if (pinsSame && own(prev) === own(next)) continue;
    const before = surfaceRefs(prev, session);
    if (sameRefs(before, refs)) continue;
    const values = repairScope({ refs: before, ...scopeValues(prev, session) }, refs, renamed);
    if (!sameJson(values, scopeValues(next, session))) repaired.push([session, values]);
  }
  return repaired;
}

// M3: the refs one write added to its writer's scope (`before` its refs then) join that scope's lower group, when it has
// one; an id the write renamed in place is no new ref.
function placedBelow(prev: Scoped, after: Scoped, repaired: [AppSessionId | null, ScopeValues][], session: AppSessionId | null, before: readonly PanelTabRef[], renamed?: ReadonlyMap<string, string>): [AppSessionId | null, ScopeValues][] {
  const held = new Set([...before.map((t) => t.id), ...(renamed?.values() ?? [])]);
  const added = surfaceRefs(after, session).flatMap((t) => (held.has(t.id) ? [] : [t.id]));
  const at = repaired.findIndex(([scope]) => scope === session);
  const values = at === -1 ? scopeValues(prev, session) : repaired[at][1];
  const joined = joinLower(values, added);
  if (joined === values) return repaired;
  return at === -1 ? [...repaired, [session, joined]] : repaired.map((entry, i) => (i === at ? [session, joined] : entry));
}

// A group's tab that takes the place of `tabId` leaving it: the next tab to its right that stays, else the last one.
function neighbour(group: SideGroup, tabId: string, left: readonly PanelTabRef[]): PanelTabRef | null {
  const ids = new Set(left.map((t) => t.id));
  return group.tabs.slice(group.tabs.findIndex((t) => t.id === tabId) + 1).find((t) => ids.has(t.id)) ?? left.at(-1) ?? null;
}

// `moveSurfaceTab`'s groups: the tab joins the other group and is in view there, the group it left shows its neighbour;
// moving a group's only tab leaves one group; moving below with one group makes the second group with that tab alone,
// refused (null) when the group has one tab.
export function groupsAfterMove(groups: SideGroups, refs: readonly PanelTabRef[], tabId: string, to: 'upper' | 'lower'): SideGroups | null {
  const from = groupOf(groups, tabId);
  const tab = refs.find((t) => t.id === tabId);
  if (from === null || from === to || tab === undefined) return null;
  if (groups.lower === null) {
    const left = groups.upper.tabs.filter((t) => t.id !== tabId);
    if (left.length === 0) return null;
    const shown = groups.upper.shown !== null && groups.upper.shown.id !== tabId ? groups.upper.shown : neighbour(groups.upper, tabId, left);
    return { upper: { tabs: left, shown }, lower: { tabs: [tab], shown: tab, share: 0.5 }, hidden: false };
  }
  const source = from === 'upper' ? groups.upper : groups.lower;
  const target = from === 'upper' ? groups.lower : groups.upper;
  const left = source.tabs.filter((t) => t.id !== tabId);
  if (left.length === 0) return { upper: { tabs: [...refs], shown: tab }, lower: null, hidden: false };
  const moved: SideGroup = { tabs: refs.filter((t) => t.id === tabId || target.tabs.includes(t)), shown: tab };
  const stayed: SideGroup = { tabs: left, shown: source.shown !== null && source.shown.id !== tabId ? source.shown : neighbour(source, tabId, left) };
  const [upper, lower] = from === 'upper' ? [stayed, moved] : [moved, stayed];
  return { upper, lower: { ...lower, share: groups.lower.share }, hidden: false };
}

export function createLayoutStore() {
  // Where each closed tab stood, so ⌘⇧T puts it back there (transient: `closedTabs` persists refs only).
  const closedAt = new Map<string, number>();
  return create<LayoutState>()((write, get) => {
    const set = (patch: Partial<LayoutState>) => write((state) => ({ ...patch, regions: surfaceRegions({ ...state, ...patch }) }));
    // Tab changes made before the persisted tabs are read (a row click, a card, a menu action or a new session racing
    // the first `layout.get`) apply at once and are kept, then replayed over the hydrated tabs, so hydration never
    // wipes what the user just opened. After hydration a change simply applies.
    // P4-B3x: every change of the tabs or the regions lands through `commit`, so the fold rule holds at every state.
    // P5 O6 M2: every change lands with its session tabs titled, so a tab is titled when it opens
    let titleOf: TitleOf = () => undefined;
    // The regions' changes made before the persisted value arrives, replayed over it (W5, below).
    const earlyRegions: ((r: LayoutRegions) => LayoutRegions)[] = [];
    // `also`: what lands in the same write (U7b: the page and the dialog an act that shows a tab closes). UX wave U7b (the
    // architect's ruling on M5): while the Overview is over the main region, the side column is docked. The Overview
    // opened over a page docks nothing (the page writes nothing of the side column), so a write that closes the page
    // under the Overview docks the column then.
    const commit = (nextMain: Strip, nextRegions: LayoutRegions, also?: Partial<Pick<LayoutState, 'destination' | 'settings'>>) => {
      const docks = also?.destination === null && get().destination !== null && get().overviewOpen;
      if (docks && !get().hydrated) earlyRegions.push(docked);
      const next = reconcileFold(get().main, { main: model.titleTabs(nextMain, titleOf), regions: docks ? docked(nextRegions) : nextRegions });
      set({ ...next, panelSurfaces: rememberSurfaceContext(get(), next.main), ...also });
    };
    const earlySurfaces: ((state: PanelSurfaces) => PanelSurfaces)[] = [];
    const surfaces = (change: (state: PanelSurfaces) => PanelSurfaces, from = get().panelSurfaces) => {
      if (!get().hydrated) earlySurfaces.push(change);
      return change(from);
    };
    // UX wave U8b: a state with scopes' values written in (`scopePatch`), the stacks through `surfaces` as every write of
    // them goes.
    const withScopes = (state: Scoped, entries: Iterable<[AppSessionId | null, ScopeValues]>) => {
      const { stacks, ...patch } = scopePatch(state, entries);
      return { ...patch, panelSurfaces: Object.keys(stacks).length === 0 ? state.panelSurfaces : surfaces((s) => withStacks(s, stacks), state.panelSurfaces) };
    };
    // One scope's groups written as §A stores them (an act's result: the stack is always written).
    const showGroups = (appSessionId: AppSessionId | null, groups: SideGroups) => {
      const state = get();
      const values = valuesOf(groups, false, state.panelGroups.lower[surfaceScope(appSessionId)]?.tabs);
      set(withScopes(state, [[appSessionId, values]]));
    };
    // UX wave U8b: a card opened or folded before the stored folds are read is replayed over them likewise.
    const earlyCards: ((open: CardId[]) => CardId[])[] = [];
    const early: ((m: Strip) => Strip)[] = [];
    const main = (next: (m: Strip) => Strip, also?: Partial<Pick<LayoutState, 'destination' | 'settings'>>) => {
      if (!get().hydrated) early.push(next);
      commit(next(get().main), get().regions, also);
    };
    // UX wave U7b ("At hydration", rules 1 and 2): what the person did before the layout was read. `pageEarly`: a page
    // opened or closed; `shownEarly`: an act that shows a tab, outside `quietly`. The replay of `early` changes the strip
    // only, so what an early act closed is decided here and not replayed.
    let pageEarly = false;
    let shownEarly = false;
    // U13a (rule 7; the plan's §C and its table): every act that brings a tab to the front lands here, and nothing else
    // does; it stands for the act, whether or not the strip changes with it. U7b: it closes the page and the dialog in the
    // same store write, unless it runs inside `quietly` (an agent's or a mod's act, Interfaces §F).
    const commitShown = (next: (m: Strip) => Strip) => {
      if (quiet > 0) return main(next);
      if (!get().hydrated) shownEarly = true;
      main(next, { destination: null, settings: null });
    };
    // The regions likewise (W5: a project opened in the sidebar, or a region toggled, before the persisted value arrives
    // is kept over it).
    const regions = (next: (r: LayoutRegions) => LayoutRegions) => {
      if (!get().hydrated) earlyRegions.push(next);
      commit(get().main, next(get().regions));
    };
    // P5 O6 M5: hydration's answer to what a pre-M5 project key becomes, and this machine (for `'other'`)
    let rekeyOf: model.RekeyOf = WAIT;
    let localMachine: MachineRef | null = null;
    const rekeyRegions = (r: LayoutRegions): LayoutRegions => {
      if (localMachine === null) return r;
      const expandedProjects = model.rekeyExpanded(r.sidebar.expandedProjects, rekeyOf, localMachine);
      return sameJson(expandedProjects, r.sidebar.expandedProjects) ? r : { ...r, sidebar: { ...r.sidebar, expandedProjects } };
    };
    // Every change of the pins goes through here, so the no-session selection is revalidated against them each time;
    // an unchanged list keeps its identity, so nothing is persisted for a selection change alone.
    const pins = (next: PanelTabRef[], requested?: string | null) => {
      const before = get().panelPinned;
      const panelPinned = samePins(before, next) ? before : next;
      return { panelPinned, panelActiveNoSession: requested === null ? null : pinSelection(before, panelPinned, get().panelActiveNoSession, requested) };
    };
    return {
      regions: LAYOUT_DEFAULTS.regions,
      main: LAYOUT_DEFAULTS.main,
      panelPinned: LAYOUT_DEFAULTS.panelPinned,
      panelBySession: new Map(),
      panelActiveNoSession: null,
      panelParams: {},
      panelSurfaces: NO_SURFACES,
      panelGroups: PANEL_GROUPS_DEFAULT, // UX wave U8b
      panelWidths: PANEL_WIDTHS_DEFAULT,
      cardsOpen: [...CARDS_OPEN_DEFAULT],
      firstReadPending: false,
      knownSession: () => true,
      hydrated: false,
      dragging: null,
      overviewOpen: false,
      destination: null,
      settings: null,

      async hydrate(client, known, opts = {}) {
        set({ knownSession: known });
        rekeyOf = opts.rekeyOf ?? WAIT;
        titleOf = opts.titleOf ?? titleOf;
        localMachine = client.localMachine;
        const absent: LayoutKey[] = []; // keys layout.json does not hold yet (not keys that failed to read)
        const readAs = new Map<LayoutKey, unknown>(); // each key read as a valid value, as layout.json holds it
        const failed: LayoutKey[] = []; // keys whose read did not answer (UX wave U8b: the first read waits for them)
        const read = async <T>(key: LayoutKey, schema: z.ZodType<T>, fallback: T): Promise<T> => {
          const result = await client.invoke('layout.get', { key });
          if (!result.ok) {
            console.error(`[layout] layout.get ${key} failed`, result.error);
            failed.push(key);
            return fallback;
          }
          if (result.value.value === null) {
            absent.push(key);
            return fallback;
          }
          const parsed = schema.safeParse(result.value.value);
          if (!parsed.success) console.warn(`[layout] ${key} is not a valid value; using the default`);
          else readAs.set(key, result.value.value);
          return parsed.success ? parsed.data : fallback;
        };
        const listed = await client.invoke('layout.list', undefined);
        // P4-B3's keys are read only when layout.json holds them (as a session's panel key is), so a layout without them
        // costs no read.
        const held = new Set<string>(listed.ok ? listed.value.keys : []);
        // UX wave U8b: a key not read because the listing failed counts as failed, so hydration writes nothing over it.
        const readHeld = <T>(key: LayoutKey, schema: z.ZodType<T>, fallback: T): Promise<T> => {
          if (held.has(key)) return read(key, schema, fallback);
          if (!listed.ok) failed.push(key);
          return Promise.resolve(fallback);
        };
        // P5 O6 M2 (OX2): a session's panel key is its address's; a bare one is from before O6, the local machine's, renamed
        // below once read. Every other key from before O6 reads lifted with the local machine (`storedMainSchema` and the rest).
        const local = client.localMachine;
        const panelKeys = listed.ok
          ? listed.value.keys.flatMap((key) => {
              const match = PANEL_KEY.exec(key);
              if (!match || key === 'panel.pinned') return [];
              const stored = match[1] as AppSessionId;
              return [{ key: key as LayoutKey, id: isAddress(stored) ? stored : addressOf(local, stored), bare: !isAddress(stored) }];
            })
          : [];
        // UX wave U8b (Interfaces §A): the three keys of the side column; a profile without `panelTools.groups` is read
        // for the first time by this build (below).
        const [storedGroups, storedWidths, storedCards, storedPage] = await Promise.all([
          readHeld('panelTools.groups', PanelGroupsSchema, PANEL_GROUPS_DEFAULT),
          readHeld('panelTools.widths', PanelWidthsSchema.nullable(), null),
          readHeld('cards.open', CardsOpenSchema, { version: 1, open: [...CARDS_OPEN_DEFAULT] }),
          readHeld('destination', StoredDestinationSchema.nullable(), null), // UX wave U7b: read only where the file holds it
        ]);
        const [persistedRegions, persistedMain, panelPinned, storedParams, storedNoSession, storedSurfaces, ...panels] = await Promise.all([
          read('regions', storedRegionsSchema(local), LAYOUT_DEFAULTS.regions), // W5: a version-1 value is migrated
          read<LayoutMain | LayoutMainV1>('main.tabs', storedMainSchema(local), storedMain(LAYOUT_DEFAULTS.main)), // W5: an Overview tab is dropped; U13a: merged below
          read('panel.pinned', PanelPinnedSchema, LAYOUT_DEFAULTS.panelPinned),
          readHeld('panelTools.params', PanelParamsSchema, { version: 1, params: {} }),
          readHeld('panelTools.activeNoSession', PanelActiveNoSessionSchema, { version: 1, activeTabId: null }),
          readHeld('panelTools.surfaces', storedPanelSurfacesSchema(local), NO_SURFACES),
          ...panelKeys.map(({ key }) => read(key, PanelSessionStateSchema.nullable(), null)),
        ]);
        opts.settle?.();
        const panelBySession = new Map<AppSessionId, PanelSessionState>();
        const renamedPanels: LayoutKey[] = []; // bare panel keys whose state moved to the address's key
        panelKeys.forEach(({ key, id, bare }, i) => {
          const state = panels[i];
          if (!state || !known(id)) return;
          panelBySession.set(id, state);
          if (bare) renamedPanels.push(key);
        });
        const replayed = early.splice(0);
        // U13a: one strip of whatever is stored (`stripOf`: the set that was showing, then every other set's tabs).
        const { strip, merged, canonical } = stripOf(persistedMain);
        // P4-B3x: the fold rule sees only where the early changes end, so a panel open at any state on the way (as read, or
        // Maximize then its toggle before the read lands) drops the fold here, as it would have live. It is dropped from
        // the value read, so a float the reader then drops opens nothing either.
        let opened = !persistedRegions.panel.collapsed;
        const replayedRegions = earlyRegions.splice(0).reduce((r, change) => {
          const next = change(r);
          opened ||= !next.panel.collapsed;
          return next;
        }, rekeyRegions(persistedRegions));
        // A fold stored in a set other than the one that was showing ends with that set's float, which the merge drops, as
        // a float the reader drops does: the panel it folded opens (below).
        const fold = storedFold(persistedMain);
        const folded: Strip = fold === null || model.foldOf(strip) !== null ? strip : { ...strip, floating: { ...fold, foldedPanel: true } };
        const restored = opened ? model.unfold(strip) : strip;
        const repaired = model.repairMain(restored, known);
        // U13a: the side column's remembered session is the one of the set that was showing (version 1's under `none`),
        // under `none` alone, which `surfaceSession` reads.
        const showing = persistedMain.version === 1 ? NO_PROJECT : persistedMain.current;
        const remembered = Object.hasOwn(storedSurfaces.contexts, showing) ? storedSurfaces.contexts[showing] : undefined;
        const contexts: PanelSurfaces['contexts'] = remembered === undefined ? {} : { [NO_PROJECT]: remembered };
        let panelSurfaces = rememberSurfaceContext({ panelSurfaces: { ...storedSurfaces, contexts }, knownSession: known }, repaired);
        const repairedMain = replayed.reduce((m, change) => {
          const next = change(m);
          panelSurfaces = rememberSurfaceContext({ panelSurfaces, knownSession: known }, next);
          return next;
        }, repaired);
        // P4-B3x: a fold restored with its float stands; one whose float the reader dropped opens the panel it folded,
        // and one stored beside an open panel is dropped (both written back below).
        const { main: hydratedMain, regions: foldedRegions } = reconcileFold(opened ? restored : folded, { main: model.titleTabs(repairedMain, titleOf), regions: replayedRegions });
        const hydratedPins = pins(panelPinned, get().panelActiveNoSession ?? storedNoSession.activeTabId);
        // UX wave U8b (Interfaces §A, "The first read"): once per profile, each session's tabs of a single-instance tool
        // that are not in view by §A's reading are dropped (the old rule never removed a tool's tab), the pins and the
        // tabs of a multi-instance or unregistered tool kept; each scope whose list that changed is repaired. It prunes and
        // marks the profile for good, so it waits for a launch at which the listing and every read answered: a failed
        // read's fallback would make a scope look as if it held less than it does (a value that answered but is not valid
        // counts as read: it reads the same at every launch, as F reads it).
        const complete = listed.ok && failed.length === 0;
        const firstRead = complete && !held.has('panelTools.groups');
        const asRead: Scoped = { ...hydratedPins, panelBySession, panelSurfaces, panelGroups: { version: 1, lower: liveGroups(storedGroups.lower, panelBySession) } };
        let hydratedPanels: Scoped = asRead;
        const prunedPanels: AppSessionId[] = [];
        if (firstRead && opts.multiInstance) {
          const multiInstance = opts.multiInstance;
          const pruned = new Map(panelBySession);
          for (const [id, own] of panelBySession) {
            const groups = sideGroups(asRead, id);
            const shown = new Set([groups.upper.shown?.id, groups.lower?.shown?.id]);
            const tabs = own.tabs.filter((tab) => shown.has(tab.id) || multiInstance(tab.toolId) !== false);
            if (tabs.length === own.tabs.length) continue;
            pruned.set(id, { ...own, tabs });
            prunedPanels.push(id);
          }
          const after = { ...asRead, panelBySession: pruned };
          const { stacks, ...repaired } = scopePatch(after, repairedScopes(asRead, after));
          hydratedPanels = { ...after, ...repaired, panelSurfaces: withStacks(after.panelSurfaces, stacks) };
        }
        // The side column's acts made while the reads were pending are replayed after the first read, which judges what
        // was stored: an act before hydration removes no stored tab the same act after it would keep (UC-14; the branch
        // review's finding 2).
        const surfaceActs = earlySurfaces.splice(0);
        if (surfaceActs.length > 0) hydratedPanels = { ...hydratedPanels, panelSurfaces: surfaceActs.reduce((state, change) => change(state), hydratedPanels.panelSurfaces) };
        // F's one width is this build's wide width once; 380, F's automatic, is automatic here too (X-165).
        const fromRegions = persistedRegions.panel.width === F_AUTOMATIC_WIDTH ? null : persistedRegions.panel.width;
        const panelWidths = storedWidths ?? { version: 1 as const, wide: fromRegions, narrow: null };
        const cardsOpen = earlyCards.splice(0).reduce((open, change) => change(open), storedCards.open); // the branch review's finding 3
        const regions = surfaceRegions({ ...get(), main: hydratedMain, regions: foldedRegions, ...hydratedPanels, hydrated: true });
        // P4-B3: the params of panel tabs no list holds now (closed, or a session's not kept) are not read; the
        // no-session selection is read back if it still names a pin.
        const live = livePanelTabIds(hydratedPanels.panelPinned, hydratedPanels.panelBySession);
        const panelParams = Object.fromEntries(Object.entries(storedParams.params).filter(([id]) => live.has(id)));
        const firstReadPending = !complete && !held.has('panelTools.groups');
        // UX wave U7b ("At hydration"): the page to open is the first of these that applies. 1: what the person opened or
        // closed before the read; 2: none after an act of theirs that showed a tab; then `pageAtStart`, over the stored
        // value as it was read, before its retired tabs were dropped: 3, a retired tab in front (a Customize, Projects or
        // Artifacts tab opens its page, a Settings tab none); 4, the stored page, when the stored tabs have the stored
        // form's shape (`canonical`, a test of shape and not of who wrote them); 5, otherwise none.
        // Rules 3 and 4 ask it of the stored value: a `main.tabs` that is absent or does not parse is not of that shape,
        // though the default put in its place is, and has no tab in front.
        const shaped = canonical && readAs.has('main.tabs');
        const destination = pageEarly ? get().destination : shownEarly ? null : pageAtStart({ rawMain: readAs.get('main.tabs'), canonical: shaped, stored: storedPage?.destination ?? null });
        set({ regions, main: hydratedMain, ...hydratedPanels, panelParams, panelWidths, cardsOpen, firstReadPending, destination, hydrated: true });
        // A first launch writes the defaults of the keys it lacks, so layout.json always holds the renderer's three
        // fixed keys (acceptance item 6 lists them). Tabs replayed over the saved ones differ from what layout.json holds,
        // and persistence takes the hydrated state as its baseline, so they are written here too. Everything after this
        // is written only when it changes.
        // P4-B3 (its Decision Log 23, tracker row 126): a `main.tabs` the reader rewrote (a tab of an unknown or retired kind
        // dropped, a deliverable tab converted) is written back too, so its warning is said once and a later build's kind
        // read after a downgrade is gone from layout.json for good.
        const unsaved = new Set(absent);
        const rewritten = readAs.has('main.tabs') && !sameJson(readAs.get('main.tabs'), persistedMain);
        // P4-B3x: so is one whose fold hydration dropped, or the next launch would read the stale mark again (a float the
        // reader drops would reopen a panel the owner has since closed).
        const unfolded = model.foldOf(folded) !== null && model.foldOf(hydratedMain) === null;
        const titled = model.titleTabs(repairedMain, titleOf) !== repairedMain; // P5 O6 M2: a title learnt at hydration is kept
        // U13a: and one whose envelope is not the stored form's (version 1, several sets, one under a project's key, an
        // empty set beside `none`), so `main.tabs` and the remembered session are both under `none` from here on.
        const changed = replayed.length > 0 && !sameJson(storedMain(hydratedMain), persistedMain);
        if (!canonical || rewritten || unfolded || titled || changed) unsaved.add('main.tabs');
        if (regions !== persistedRegions || (readAs.has('regions') && !sameJson(readAs.get('regions'), persistedRegions))) unsaved.add('regions'); // P5 O6 M2: a migrated version too
        if (!sameJson(get().panelSurfaces, storedSurfaces) || (readAs.has('panelTools.surfaces') && !sameJson(readAs.get('panelTools.surfaces'), storedSurfaces))) unsaved.add('panelTools.surfaces');
        // UX wave U8b: the three keys are written at a first read (so the next launch is not one), and each session list
        // the first read pruned, with the params it left (persistence takes the filtered params as its baseline).
        if (complete) for (const key of ['panelTools.groups', 'panelTools.widths', 'cards.open'] as const) if (!held.has(key)) unsaved.add(key);
        if (!sameJson(cardsOpen, storedCards.open)) unsaved.add('cards.open'); // a fold made while the reads were pending
        for (const id of prunedPanels) unsaved.add(`panel.${id}`);
        // UX wave U7b: `destination` is written, or deleted, where what hydration opened differs from the file; a stored
        // value that does not parse (warned once above) is left in the file until the next page is opened or closed.
        if (readAs.has('destination') ? !sameJson(storedValue('destination', destination), readAs.get('destination')) : destination !== null) unsaved.add('destination');
        // A read of `main.tabs` that failed says nothing of the file (R9): no page opens by rule 4, and none is deleted,
        // unless the person opened, closed or left one before the read (rules 1 and 2).
        if (failed.includes('main.tabs') && !pageEarly && !shownEarly) unsaved.delete('destination');
        if (prunedPanels.length > 0 && Object.keys(panelParams).length !== Object.keys(storedParams.params).length) unsaved.add('panelTools.params');
        for (const key of failed) unsaved.delete(key); // UX wave U8b: hydration writes no default over a value it could not read
        const values: Partial<Record<LayoutKey, unknown>> = {
          regions, 'main.tabs': storedMain(get().main), 'panel.pinned': panelPinned, 'panelTools.surfaces': get().panelSurfaces,
          'panelTools.groups': get().panelGroups, 'panelTools.widths': panelWidths, 'cards.open': storedValue('cards.open', cardsOpen),
          'panelTools.params': storedValue('panelTools.params', panelParams), destination: storedValue('destination', destination),
          ...Object.fromEntries(prunedPanels.map((id) => [`panel.${id}`, get().panelBySession.get(id)])),
        };
        for (const key of unsaved) {
          if (!(key in values)) continue;
          void client.invoke('layout.set', { key, value: values[key] }).then((result) => {
            if (!result.ok) console.error(`[layout] layout.set ${key} failed`, result.error);
          });
        }
        // P5 O6 M2: a bare panel key is written under its address, then deleted, so layout.json keeps one key per session.
        for (const bare of renamedPanels) {
          const id = panelKeys.find((entry) => entry.key === bare)!.id;
          const state = get().panelBySession.get(id); // UX wave U8b: as the first read left it
          if (state === undefined) continue;
          void client.invoke('layout.set', { key: `panel.${id}`, value: state }).then(async (written) => {
            if (!written.ok) return console.error(`[layout] layout.set panel.${id} failed`, written.error);
            const deleted = await client.invoke('layout.set', { key: bare, value: null });
            if (!deleted.ok) console.error(`[layout] cannot drop ${bare}`, deleted.error);
          });
        }
        return { merged };
      },

      openTab: (ref, opts) => (opts?.activate === false ? main : commitShown)((m) => model.openTab(m, ref, opts)),
      openSession(appSessionId, opts = {}) {
        // I2: a replace never takes an unstarted tab's place (a draft, C10): the session opens in a tab of its own right
        // after it, at once, so the change lands in the click's own task (the floating Overview closes on it). The live
        // call then asks the draft's close guard (only about a non-empty draft) and drops the draft when it may go, so
        // the session ends up in its place with no ⌘⇧T entry; declined, both stay. The same check runs again when an
        // early change is replayed over the hydrated tabs, where a draft it meets is kept and never asked about.
        // E11 F2b (plan 2.5): any other unpinned tab gives its place unless the guard's verdict keeps it (an unsaved file,
        // a launch in flight: the session opens beside it, and the owner is told why) or sets it aside (an unstarted
        // chat's draft: replaced, its intent and draft kept for ⌘⇧T, and the owner told).
        const guard = replaceGuard;
        const inTheWay = (m: Strip): TabRef | null => {
          if (opts.split || opts.how === 'tab' || model.isOpen(m, `session:${appSessionId}`)) return null;
          const shown = model.activeTab(m);
          return shown !== null && !shown.pinned ? shown : null;
        };
        const verdictOf = (tab: TabRef | null): ReplaceVerdict => (tab === null ? null : (guard?.verdict?.(tab) ?? null));
        const draftInTheWay = (m: Strip): Extract<TabRef, { kind: 'session' }> | null => {
          const shown = inTheWay(m);
          return shown?.kind === 'session' && guard !== null && guard.unstarted(shown.appSessionId) && verdictOf(shown) === null ? shown : null;
        };
        const kept = (m: Strip) => {
          if (draftInTheWay(m) !== null) return true;
          const reason = verdictOf(inTheWay(m));
          return reason !== null && 'keep' in reason;
        };
        const shown = inTheWay(get().main);
        const verdict = verdictOf(shown);
        const draft = draftInTheWay(get().main);
        // Replayed over the hydrated tabs (the first call is the live one), only a started session's tab is replaced, as
        // before E11: a restored file, Settings, Diagnostics or unstarted draft the person never saw stays (a draft whatever
        // its verdict: nothing is set aside unseen), and the session opens beside it.
        let replayed = false;
        commitShown((m) => {
          const restored = replayed ? inTheWay(m) : null;
          const restoredStays = restored !== null && (restored.kind !== 'session' || guard?.unstarted(restored.appSessionId) === true);
          const beside = kept(m) || restoredStays;
          replayed = true;
          return model.openSession(m, appSessionId, { ...opts, how: beside ? 'tab' : opts.how });
        });
        if (shown !== null && verdict !== null) guard?.announce?.(shown, verdict);
        if (draft === null || guard === null) return;
        // A draft that started while its guard decided (its record arrived) is a live session now: its tabs, history and
        // panel stay.
        void guard.discard(draft).then((discarded) => {
          if (discarded && guard.unstarted(draft.appSessionId)) get().dropSession(draft.appSessionId);
        });
      },
      // Called on every records change, so nothing is set (and no subscriber woken) when nothing changes.
      refreshTabTitles() {
        if (!get().hydrated) return;
        const next = model.titleTabs(get().main, titleOf);
        if (next !== get().main) commit(next, get().regions);
      },
      rekeyProjects() {
        if (!get().hydrated) return;
        const nextRegions = rekeyRegions(get().regions);
        if (nextRegions !== get().regions) commit(get().main, nextRegions);
      },
      closeTab(id, opts = {}) {
        const found = model.locateTab(get().main, id);
        if (found && opts.remember !== false) closedAt.set(id, found.index);
        main((m) => model.closeTab(m, id, opts));
      },
      retargetTab: (id, target) => main((m) => model.retargetTab(m, id, target)), // cua #90
      reopenClosed() {
        const last = get().main.closedTabs.at(-1);
        if (!last) return;
        const at = closedAt.get(last.id) ?? null;
        closedAt.delete(last.id);
        commitShown((m) => model.reopenClosed(m, at));
      },
      moveTab: (id, toPane, index) => commitShown((m) => model.moveTab(m, id, toPane, index)),
      reorderTab(id, index) {
        const at = model.locateTab(get().main, id);
        if (at !== null) commitShown((m) => model.moveTab(m, id, at.pane, index));
      },
      selectTab: (n) => commitShown((m) => model.selectTab(m, n)),
      cycleTab: (delta) => commitShown((m) => model.cycleTab(m, delta)),
      activateTab: (id) => commitShown((m) => model.activateTab(m, id)),
      togglePinned: (id) => main((m) => model.togglePinned(m, id)),
      splitWithActive: () => commitShown(model.splitWithActive),
      focusPane: (i) => main((m) => model.focusPane(m, i)),
      showPane: (i) => commitShown((m) => model.focusPane(m, i)),
      setSplitRatio: (r) => main((m) => model.setSplitRatio(m, r)),
      floatSplit(sessionTabId, opts = {}) {
        // P4-B3x: Expand's fold, over an open panel and a float that happens (not one the model refuses or docks), lands
        // with the float in one change (the collapse clears a maximized or floating panel too). An open panel means no
        // fold stands, so any fold in the result is this one. Before the layout is read nothing folds: nothing is on
        // screen to expand.
        const { main: before, regions: r, hydrated } = get();
        const folded = model.floatSplit(before, sessionTabId, { foldedPanel: true });
        if (opts.foldPanel && hydrated && !r.panel.collapsed && model.foldOf(folded) !== null) commit(folded, { ...r, panel: panelAfter(r.panel, { collapsed: true }) });
        else main((m) => model.floatSplit(m, sessionTabId));
      },
      dockSplit: () => main(model.dockSplit),
      dropSession(appSessionId) {
        main((m) => model.dropSession(m, appSessionId));
        if (get().panelBySession.has(appSessionId)) {
          const panelBySession = new Map(get().panelBySession);
          panelBySession.delete(appSessionId);
          const lower = liveGroups(get().panelGroups.lower, panelBySession); // UX wave U8b: its lower entry goes with it
          set({ panelBySession, ...(lower === get().panelGroups.lower ? {} : { panelGroups: { version: 1, lower } }) });
        }
      },
      settleMachine(machine) {
        const { hydrated, knownSession, main: current, panelBySession } = get();
        if (!hydrated) return;
        const sessions = new Set<AppSessionId>(panelBySession.keys());
        for (const tab of [...model.allTabs(current), ...current.closedTabs]) if (tab.kind === 'session' || tab.kind === 'agent') sessions.add(tab.appSessionId);
        for (const id of sessions) if (machineOf(id) === machine && !knownSession(id)) get().dropSession(id);
      },

      setSidebar: (patch) => regions((r) => ({ ...r, sidebar: { ...r.sidebar, ...(typeof patch === 'function' ? patch(r.sidebar) : patch) } })),
      setPanel: (patch) => regions((r) => ({ ...r, panel: panelAfter(r.panel, patch) })),
      revealMain: () => regions(docked),
      setFloatingCardSize(key, size) {
        regions((r) => {
          const state = get();
          const live = new Set([SUMMARY_CARD_KEY, ...livePanelTabIds(state.panelPinned, state.panelBySession), ...model.allTabs(state.main).map((t) => mainCardKey(t.id))]); // P4-B3: main keys
          const kept = Object.entries(r.floatingCard).filter(([k]) => k !== key && live.has(k));
          return { ...r, floatingCard: Object.fromEntries([...kept, [key, size]].slice(-FLOATING_CARD_SIZES_MAX)) };
        });
      },
      setOverviewOpen(overviewOpen) {
        // Overview lives over main, so opening it restores main, including when regions are still hydrating. UX wave
        // U7b: it opens over a page, which stays, and closes the Settings dialog; over a page it docks nothing until the
        // page closes under it (`commit`).
        if (overviewOpen && get().destination === null) get().revealMain();
        set({ overviewOpen, ...(overviewOpen && get().settings !== null ? { settings: null } : {}) });
      },
      setOverviewRect: (overview) => regions((r) => ({ ...r, overview })),
      setPanelTabPinned(appSessionId, tabId, pinned) {
        const prev = get();
        const own = prev.panelBySession.get(appSessionId) ?? { tabs: [], activeTabId: null };
        const panelBySession = new Map(prev.panelBySession);
        let patch: Pick<LayoutState, 'panelPinned' | 'panelActiveNoSession' | 'panelBySession'>;
        if (pinned) {
          const tab = own.tabs.find((t) => t.id === tabId);
          if (!tab) return;
          panelBySession.set(appSessionId, { ...own, tabs: own.tabs.filter((t) => t.id !== tabId) });
          patch = { ...pins([...prev.panelPinned, { ...tab, pinned: true }]), panelBySession };
        } else {
          const tab = prev.panelPinned.find((t) => t.id === tabId);
          if (!tab) return;
          panelBySession.set(appSessionId, { ...own, tabs: [...own.tabs, { ...tab, pinned: false }] });
          patch = { ...pins(prev.panelPinned.filter((t) => t.id !== tabId)), panelBySession };
        }
        // UX wave U8b (M1, decision 5): a pin that moves leaves or joins every scope's strip, which each repairs.
        const next = { ...prev, ...patch };
        set({ ...patch, ...withScopes(next, repairedScopes(prev, next)) });
      },
      setPanelTabs(appSessionId, next, opts) {
        const prev = get();
        const refsBefore = prev.effectivePanelTabs(appSessionId);
        const pinned = next.tabs.filter((t) => t.pinned);
        const panelPinned = samePins(prev.panelPinned, pinned) ? prev.panelPinned : pinned;
        const panelBySession = new Map(prev.panelBySession);
        if (appSessionId !== null) panelBySession.set(appSessionId, { tabs: next.tabs.filter((t) => !t.pinned), activeTabId: prev.panelBySession.get(appSessionId)?.activeTabId ?? null });
        // UX wave U8b (M1, decision 5; M2, decision 2): the refs are written as they come and every scope they reach is
        // repaired from what it stored, the writer's own included; `next.activeTabId` is no request.
        const patch = { panelPinned, ...(appSessionId === null ? {} : { panelBySession }) };
        const after = { ...prev, ...patch };
        const renamed = renamedIn(refsBefore, next.tabs);
        const repaired = repairedScopes(prev, after, renamed);
        set({ ...patch, ...withScopes(after, opts?.group === 'lower' ? placedBelow(prev, after, repaired, appSessionId, refsBefore, renamed) : repaired) });
      },
      toggleSurfacePin(toolId) {
        set({ panelSurfaces: surfaces((state) => ({
          ...state,
          pinnedTools: state.pinnedTools.includes(toolId) ? state.pinnedTools.filter((id) => id !== toolId) : [...state.pinnedTools, toolId],
        })) });
      },
      effectivePanelTabs(appSessionId) {
        const own = appSessionId === null ? [] : (get().panelBySession.get(appSessionId)?.tabs ?? []);
        return [...get().panelPinned, ...own];
      },
      panelTabsOf: (appSessionId) => get().effectivePanelTabs(appSessionId),
      updatePanelTabs(appSessionId, fn, opts) {
        const after = fn(get().effectivePanelTabs(appSessionId));
        get().setPanelTabs(appSessionId, { tabs: after, activeTabId: get().panelBySession.get(appSessionId)?.activeTabId ?? null }, { group: opts?.group });
        if (opts?.activate !== undefined) get().showSurfaceTab(appSessionId, opts.activate);
      },
      setPanelParams(tabId, params) {
        const held = get().panelParams;
        if (params === null ? !(tabId in held) : sameJson(held[tabId], params)) return;
        const live = livePanelTabIds(get().panelPinned, get().panelBySession);
        const kept = Object.entries(held).filter(([id]) => id !== tabId && live.has(id));
        set({ panelParams: Object.fromEntries(params === null ? kept : [...kept, [tabId, params]]) });
      },
      setDragging: (dragging) => set({ dragging }),

      // ---- UX wave U7b (Interfaces §F): the page and the dialog; none of these touches the strip ----
      openDestination(target) {
        if (!get().hydrated) pageEarly = true;
        const { destination: now, settings } = get();
        const destination = now !== null && sameJson(now, target) ? now : target;
        if (destination !== now || settings !== null) set({ destination, settings: null });
      },
      closeDestination() {
        if (get().destination === null) return;
        if (!get().hydrated) pageEarly = true;
        if (get().overviewOpen) commit(get().main, get().regions, { destination: null }); // the column docks under the Overview
        else set({ destination: null });
      },
      openSettings(section) {
        // Each request for a section is a new value, so the view lands on it even when it is the section already asked
        // for: the person may have moved in the view since (the branch review). Open already, no section changes nothing.
        if (get().settings === null) set({ settings: { section: section ?? null } });
        else if (section !== undefined) set({ settings: { section } });
      },
      closeSettings() {
        if (get().settings !== null) set({ settings: null });
      },
      closeFront() {
        if (get().settings !== null) get().closeSettings();
        else if (get().destination !== null) get().closeDestination();
        else return false;
        return true;
      },

      // ---- UX wave U8b (Interfaces §B): the acts that change what is in view ----
      showSurfaceTab(appSessionId, tabId) {
        const groups = sideGroups(get(), appSessionId);
        const group = groupOf(groups, tabId);
        if (group === null) return;
        const tab = (group === 'upper' ? groups.upper : groups.lower!).tabs.find((t) => t.id === tabId)!;
        showGroups(appSessionId, group === 'upper'
          ? { ...groups, upper: { ...groups.upper, shown: tab }, hidden: false }
          : { ...groups, lower: { ...groups.lower!, shown: tab }, hidden: false });
      },
      hideSurfaces(appSessionId) {
        showGroups(appSessionId, { ...sideGroups(get(), appSessionId), hidden: true });
      },
      moveSurfaceTab(appSessionId, tabId, to) {
        const moved = groupsAfterMove(sideGroups(get(), appSessionId), surfaceRefs(get(), appSessionId), tabId, to);
        if (moved !== null) showGroups(appSessionId, moved);
      },
      setGroupShare(appSessionId, share) {
        const groups = sideGroups(get(), appSessionId);
        if (groups.lower !== null) showGroups(appSessionId, { ...groups, lower: { ...groups.lower, share: clampShare(share) } });
      },
      setPanelWidth(px) {
        const state = get();
        const width = px === null ? null : Math.round(px);
        const key = panelWidthClass(state);
        if (state.panelWidths[key] !== width) set({ panelWidths: { ...state.panelWidths, [key]: width } });
        state.setPanel({ width: width ?? F_AUTOMATIC_WIDTH });
      },
      setCardOpen(card, open) {
        const change = (now: CardId[]) => (now.includes(card) === open ? now : CARD_IDS.filter((id) => (id === card ? open : now.includes(id))));
        if (!get().hydrated) earlyCards.push(change); // replayed over the stored folds (the branch review's finding 3)
        const next = change(get().cardsOpen);
        if (next !== get().cardsOpen) set({ cardsOpen: next });
      },
    };
  });
}

export const useLayout = createLayoutStore();

// ---- persistence ------------------------------------------------------------------------------------------------------

export const LAYOUT_WRITE_DELAY_MS = 250;

// Each persisted key and the state slice it holds; a slice is replaced (never mutated) when it changes, and is written
// as `storedValue` makes it.
function persistedKeys(state: LayoutState): Map<LayoutKey, unknown> {
  const keys = new Map<LayoutKey, unknown>([
    ['regions', state.regions],
    ['main.tabs', state.main],
    ['panel.pinned', state.panelPinned],
    ['panelTools.params', state.panelParams], // P4-B3
    ['panelTools.activeNoSession', state.panelActiveNoSession], // P4-B3
    ['panelTools.surfaces', state.panelSurfaces], // UX2-L
    ['panelTools.groups', state.panelGroups], // UX wave U8b
    ['panelTools.widths', state.panelWidths],
    ['cards.open', state.cardsOpen],
    ['destination', state.destination], // UX wave U7b: null while no page is open, which deletes the key
  ]);
  for (const [id, panel] of state.panelBySession) keys.set(`panel.${id}`, panel);
  return keys;
}

// The sessions a tab holds open in the strip: their own tab or an agent's (the tabs an archive closes).
const openSessionsOf = (main: Strip): AppSessionId[] =>
  model.allTabs(main).flatMap((tab) => (tab.kind === 'session' || tab.kind === 'agent' ? [tab.appSessionId] : []));

// A session's panel key whose session is another machine's than `local`.
function otherMachinePanelKey(key: LayoutKey, local: MachineRef): boolean {
  const id = PANEL_KEY.exec(key)?.[1];
  return id !== undefined && key !== 'panel.pinned' && isAddress(id) && machineOf(id) !== local;
}

// Every key as `persistLayout` writes it from this state (UX wave U8b: what the suites hold against build F's reader).
export function storedLayout(state: LayoutState): Map<LayoutKey, unknown> {
  return new Map([...persistedKeys(state)].map(([key, slice]) => [key, storedValue(key, slice)]));
}

// The value a key's slice is written as: P4-B3's two keys wrap theirs in a versioned value, `main.tabs` is the strip's
// stored form (U13a, UC-14), every other key is its slice.
function storedValue(key: LayoutKey, slice: unknown): unknown {
  if (key === 'main.tabs') return storedMain(slice as Strip);
  if (key === 'panelTools.params') return { version: 1, params: slice };
  if (key === 'panelTools.activeNoSession') return { version: 1, activeTabId: slice };
  if (key === 'cards.open') return { version: 1, open: slice }; // UX wave U8b
  if (key === 'destination') return slice === null ? null : { version: 1, destination: slice }; // UX wave U7b
  return slice;
}

// Writes each changed key through `layout.set`, 250 ms after that key's last change, and every pending key at once on
// `beforeunload` and on stop. Nothing is written before hydration (the persisted values are not known yet, so a write
// would clobber them) or for hydration itself.
// l1-sessions-13: main's inactivity sweep keeps every session `main.tabs` holds open, so a session tab (or one of its
// agents') joining the tabs is written at once rather than after the delay; a tab leaving waits as any change does.
export function persistLayout(client: MawsBridge, store = useLayout): () => void {
  const pending = new Map<LayoutKey, { timer: ReturnType<typeof setTimeout>; value: unknown }>();
  let written: Map<LayoutKey, unknown> | null = store.getState().hydrated ? persistedKeys(store.getState()) : null;
  let published = new Set(written ? openSessionsOf(store.getState().main) : []); // the sessions main's `main.tabs` holds open

  const write = (key: LayoutKey, slice: unknown) => {
    if (key === 'main.tabs') published = new Set(openSessionsOf(slice as Strip));
    void client.invoke('layout.set', { key, value: storedValue(key, slice) }).then((result) => {
      if (!result.ok) console.error(`[layout] layout.set ${key} failed`, result.error);
    });
  };
  const schedule = (key: LayoutKey, value: unknown) => {
    const before = pending.get(key);
    if (before) clearTimeout(before.timer);
    const timer = setTimeout(() => {
      pending.delete(key);
      write(key, value);
    }, LAYOUT_WRITE_DELAY_MS);
    pending.set(key, { timer, value });
  };
  const flush = () => {
    for (const [key, { timer, value }] of pending) {
      clearTimeout(timer);
      write(key, value);
    }
    pending.clear();
  };

  const unsubscribe = store.subscribe((state) => {
    if (!state.hydrated) return;
    const now = persistedKeys(state);
    let marks = false; // UX wave U8b: this change writes the side column's state while the first read is pending
    if (written) {
      for (const [key, value] of now) {
        if (written.get(key) === value) continue;
        if (state.firstReadPending && (key === 'panelTools.surfaces' || key === 'panelTools.groups' || PANEL_KEY.test(key))) marks = true;
        if (key === 'main.tabs' && openSessionsOf(state.main).some((id) => !published.has(id))) {
          clearTimeout(pending.get(key)?.timer);
          pending.delete(key);
          write(key, value);
        } else schedule(key, value);
      }
    } else published = new Set(openSessionsOf(state.main)); // hydration wrote what differs from layout.json, open tabs included
    // A key that left the state (a removed session's `panel.<id>`, which main deletes) must not be written back by a
    // write still pending from before.
    for (const [key, { timer }] of pending) {
      if (now.has(key)) continue;
      clearTimeout(timer);
      pending.delete(key);
    }
    // P5 O6 M4: main deletes the panel key of its own removed session, never another machine's, so the page deletes that.
    for (const key of written?.keys() ?? []) if (!now.has(key) && otherMachinePanelKey(key, client.localMachine)) write(key, null);
    written = now;
    // UX wave U8b (Decision Log 3): after a deferred first read, this build's first write of a list, the stacks or the
    // groups marks the profile read, so no later launch prunes a tab this build may have shown.
    if (marks) {
      if (!pending.has('panelTools.groups')) schedule('panelTools.groups', state.panelGroups);
      store.setState({ firstReadPending: false });
    }
  });
  window.addEventListener('beforeunload', flush);
  return () => {
    unsubscribe();
    window.removeEventListener('beforeunload', flush);
    flush();
  };
}
