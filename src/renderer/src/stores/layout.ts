// The layout store (C5 execution document, Renderer stores; §4.1: layout state lives in the renderer, persistence is
// main's through `layout.*`). The four persisted keys plus transient drag and focus state. The tab and pane transitions
// are the pure functions of `layout-model.ts`; this store holds their result. Hydration reads each key, validates it
// against C5's shapes (an absent or invalid value falls back to its default) and repairs `main.tabs` against the
// sessions that exist. `persistLayout` writes each changed key back through `layout.set`, 250 ms after its last change
// and on `beforeunload`. W12 (I3): `main.tabs` holds a tab set per project; a tab of a session lives in its project's
// set, which every open of it shows first.
import { create } from 'zustand';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import {
  LAYOUT_DEFAULTS,
  NO_PROJECT,
  PanelActiveNoSessionSchema,
  PanelParamsSchema,
  PanelPinnedSchema,
  PanelSessionStateSchema,
  PanelSurfacesSchema,
  StoredMainSchema,
  StoredRegionsSchema,
  type FloatingCardSize,
  type LayoutKey,
  type LayoutMain,
  type LayoutRegions,
  type PanelSessionState,
  type PanelSurfaces,
  type PanelTabRef,
  type TabRef,
  type TabSetKey,
  type TabTarget,
} from '@shared/ipc/schema/layout';
import type * as z from 'zod';
import * as model from './layout-model';
import { normalizeSurfaceStack, rememberSurfaceContext, stackAfterSelection, surfaceRefs, surfaceScope, surfaceSession, surfaceTabs } from '../panel/surface-model';

type Pane = 0 | 1;

export interface LayoutState {
  regions: LayoutRegions;
  main: LayoutMain;
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
  // Hydration's live record/intent resolver; derivation ignores stale contexts without deleting saved preferences.
  knownSession(appSessionId: AppSessionId): boolean;
  hydrated: boolean;
  // The tab being dragged (P4-B3, X38; its Decision Log 16): a main tab, or a panel tab showing an artifact's record.
  // Transient; the drop targets decide acceptance from it (`shell/transfer.ts`).
  dragging: { source: 'main'; tabId: string; fromPane: Pane } | { source: 'panel'; tabId: string; toolId: string; artifactId: string } | null;
  // W5: whether the floating Overview is open (transient: the app opens to the last active tab, §5.2 as amended); its
  // rect persists in `regions.overview`.
  overviewOpen: boolean;
  // W12: the project a session's tabs belong with, from hydration's `projectOf` (see `hydrate`); until then every
  // session's tabs are in the no-project set.
  projectOf: ProjectOf;
  // `settle` runs once the reads are in, before `known` is first asked and the early changes are captured (debt wave 5:
  // the shell drains its batched record events there, and the removals that makes are replayed with the rest).
  // `projectOf` (W12) answers the project a session's tabs belong with (its record's, else its unstarted intent's; null
  // for none; undefined for a session not known now), from then on; until it is given, every tab is in the no-project
  // set.
  hydrate(client: MawsBridge, known: (appSessionId: AppSessionId) => boolean, opts?: { settle?: () => void; projectOf?: ProjectOf }): Promise<void>;
  // A tab of a session opens in its project's set, which the strip shows first when it is activated (W12).
  openTab(ref: TabTarget, opts?: { pane?: model.PaneTarget; activate?: boolean }): void;
  // I2: replaces the focused pane's session unless `how: 'tab'` or `split` asks otherwise (`model.openSession`); W12:
  // in the session's project's set, which the strip shows first.
  openSession(appSessionId: AppSessionId, opts?: model.OpenSessionOptions): void;
  // W12: the strip shows this project's set (null: the no-project set); a click on a project in the sidebar.
  setCurrentProject(projectId: ProjectId | null): void;
  // W12: tabs whose session's project changed move to its set (the shell calls it when records or intents change).
  refileTabs(): void;
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
  focusPane(i: Pane): void;
  setSplitRatio(r: number): void;
  // P4-B3 (X37): the split's float, `model.floatSplit` / `model.dockSplit` on the current set. P4-B3x: `foldPanel`
  // (Expand's) also folds an open right panel in the same change, marking the float as its fold (`reconcileFold`).
  floatSplit(sessionTabId: string, opts?: { foldPanel?: boolean }): void;
  dockSplit(): void;
  dropSession(appSessionId: AppSessionId): void; // session.removed
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
  // key; with no session only the pins are kept, and the selection goes to `panelActiveNoSession`.
  setPanelTabs(appSessionId: AppSessionId | null, next: PanelSessionState): void;
  // Visible tools only; hiding a surface does not close its refs or clear its params. The last slot is active.
  setSurfaceStack(appSessionId: AppSessionId | null, ids: string[]): void;
  toggleSurfacePin(toolId: string): void; // the icon-row preference, separate from keep-across-session tab pins
  effectivePanelTabs(appSessionId: AppSessionId | null): PanelTabRef[]; // panelPinned first, then the session's own
  // A session's panel refs whichever session or the Overview is on screen (C8's eleventh ask: C10's Attach adds a
  // Terminal tab to session A from a sidebar row while B is shown). Read as the host reads them (the pins first) and
  // written as `setPanelTabs` splits them: pinned refs to `panel.pinned`, the rest to `panel.<appSessionId>`. The
  // session's selection becomes `opts.activeTabId` when given and present, else stays if its tab survives, else moves
  // as the no-session selection does (`pinSelection`).
  panelTabsOf(appSessionId: AppSessionId): PanelTabRef[];
  updatePanelTabs(appSessionId: AppSessionId, fn: (refs: PanelTabRef[]) => PanelTabRef[], opts?: { activeTabId?: string }): void;
  // P4-B3 (Decision Log 22): a tool's persistable params for one of its tabs, null clearing them. Every write keeps only
  // the params of panel tabs some list holds, and the tab written (whose instance exists before its ref is written).
  setPanelParams(tabId: string, params: unknown): void;
  setDragging(dragging: LayoutState['dragging']): void;
}

const PANEL_KEY = /^panel\.([^.]+)$/;

// A session's project, null for none; undefined when the session is not known now (no record, no unstarted intent):
// its tabs stay where they are.
export type ProjectOf = (appSessionId: AppSessionId) => ProjectId | null | undefined;
export const NO_PROJECT_OF: ProjectOf = () => null;

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
export function reconcileFold(before: LayoutMain, next: Pick<LayoutState, 'main' | 'regions'>): Pick<LayoutState, 'main' | 'regions'> {
  if (!next.regions.panel.collapsed) {
    const main = model.unfold(next.main);
    return main === next.main ? next : { main, regions: next.regions };
  }
  if (!model.foldEnded(before, next.main)) return next;
  return { main: next.main, regions: { ...next.regions, panel: panelAfter(next.regions.panel, { collapsed: false }) } };
}

export const FLOATING_CARD_SIZES_MAX = 64;
// The panel tab key of the resting summary (no tab selected), in `regions.floatingCard`.
export const SUMMARY_CARD_KEY = 'summary';
// P4-B3 (its Decision Log 10): the key of the split card's size over a main tab (the pane beside the card), pruned with
// the open main tabs as a panel tab's key is with the panel lists.
export const mainCardKey = (tabId: string): string => `main:${tabId}`;

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

// A panel selection once its tabs go from `before` to `after` (the pins, for the no-session selection; a session's
// effective tabs, for `updatePanelTabs`): the requested id if it is still there, else the current one if it is, else
// the tab that took the removed one's place (the next surviving tab to its right, or the last one), else null.
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

export function createLayoutStore() {
  // Where each closed tab stood, so ⌘⇧T puts it back there (transient: `closedTabs` persists refs only).
  const closedAt = new Map<string, number>();
  return create<LayoutState>()((write, get) => {
    const set = (patch: Partial<LayoutState>) => write((state) => ({ ...patch, regions: surfaceRegions({ ...state, ...patch }) }));
    // W12: the set a session's tabs belong in, its project's; asked when a change applies (an early change replayed after
    // hydration asks the resolver hydration was given). Undefined for a session not known now: an open of it goes to the
    // current set, and its tabs are not refiled.
    const setOfSession = (appSessionId: AppSessionId): TabSetKey | undefined => {
      const project = get().projectOf(appSessionId);
      return project === undefined ? undefined : (project ?? NO_PROJECT);
    };
    const setOfTab = (tab: TabTarget): TabSetKey | null => {
      const appSessionId = model.sessionOfTab(tab);
      return appSessionId === null ? null : (setOfSession(appSessionId) ?? null);
    };
    // Tab changes made before the persisted tabs are read (a row click, a card, a menu action or a new session racing
    // the first `layout.get`) apply at once and are kept, then replayed over the hydrated tabs, so hydration never
    // wipes what the user just opened. After hydration a change simply applies.
    // P4-B3x: every change of the tabs or the regions lands through `commit`, so the fold rule holds at every state.
    const commit = (nextMain: LayoutMain, nextRegions: LayoutRegions) => {
      const next = reconcileFold(get().main, { main: nextMain, regions: nextRegions });
      set({ ...next, panelSurfaces: rememberSurfaceContext(get(), next.main) });
    };
    const earlySurfaces: ((state: PanelSurfaces) => PanelSurfaces)[] = [];
    const surfaces = (change: (state: PanelSurfaces) => PanelSurfaces) => {
      if (!get().hydrated) earlySurfaces.push(change);
      return change(get().panelSurfaces);
    };
    const early: ((m: LayoutMain) => LayoutMain)[] = [];
    const main = (next: (m: LayoutMain) => LayoutMain) => {
      if (!get().hydrated) early.push(next);
      commit(next(get().main), get().regions);
    };
    // The regions likewise (W5: a project opened in the sidebar, or a region toggled, before the persisted value arrives
    // is kept over it).
    const earlyRegions: ((r: LayoutRegions) => LayoutRegions)[] = [];
    const regions = (next: (r: LayoutRegions) => LayoutRegions) => {
      if (!get().hydrated) earlyRegions.push(next);
      commit(get().main, next(get().regions));
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
      panelSurfaces: { version: 1, stacks: {}, pinnedTools: [], contexts: {} },
      knownSession: () => true,
      hydrated: false,
      dragging: null,
      overviewOpen: false,
      projectOf: NO_PROJECT_OF,

      async hydrate(client, known, opts = {}) {
        set({ knownSession: known, ...(opts.projectOf ? { projectOf: opts.projectOf } : {}) });
        const absent: LayoutKey[] = []; // keys layout.json does not hold yet (not keys that failed to read)
        const readAs = new Map<LayoutKey, unknown>(); // each key read as a valid value, as layout.json holds it
        const read = async <T>(key: LayoutKey, schema: z.ZodType<T>, fallback: T): Promise<T> => {
          const result = await client.invoke('layout.get', { key });
          if (!result.ok) {
            console.error(`[layout] layout.get ${key} failed`, result.error);
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
        const readHeld = <T>(key: LayoutKey, schema: z.ZodType<T>, fallback: T): Promise<T> => (held.has(key) ? read(key, schema, fallback) : Promise.resolve(fallback));
        const panelIds = listed.ok
          ? listed.value.keys.flatMap((key) => {
              const match = PANEL_KEY.exec(key);
              return match && key !== 'panel.pinned' ? [match[1] as AppSessionId] : [];
            })
          : [];
        const [persistedRegions, persistedMain, panelPinned, storedParams, storedNoSession, storedSurfaces, ...panels] = await Promise.all([
          read('regions', StoredRegionsSchema, LAYOUT_DEFAULTS.regions), // W5: a version-1 value is migrated
          read('main.tabs', StoredMainSchema, LAYOUT_DEFAULTS.main), // W5: an Overview tab is dropped; W12: version 1 is filed by project
          read('panel.pinned', PanelPinnedSchema, LAYOUT_DEFAULTS.panelPinned),
          readHeld('panelTools.params', PanelParamsSchema, { version: 1, params: {} }),
          readHeld('panelTools.activeNoSession', PanelActiveNoSessionSchema, { version: 1, activeTabId: null }),
          readHeld('panelTools.surfaces', PanelSurfacesSchema, { version: 1, stacks: {}, pinnedTools: [], contexts: {} }),
          ...panelIds.map((id) => read(`panel.${id}`, PanelSessionStateSchema.nullable(), null)),
        ]);
        opts.settle?.();
        const panelBySession = new Map<AppSessionId, PanelSessionState>();
        panelIds.forEach((id, i) => {
          const state = panels[i];
          if (state && known(id)) panelBySession.set(id, state);
        });
        const replayed = early.splice(0);
        // W12: a session whose project changed while the app was closed has its tabs moved to that project's set.
        const stored = persistedMain.version === 1 ? model.fromV1(persistedMain, setOfTab) : persistedMain;
        // P4-B3x: the fold rule sees only where the early changes end, so a panel open at any state on the way (as read, or
        // Maximize then its toggle before the read lands) drops the fold here, as it would have live. It is dropped from
        // the value read, so a float the reader then drops opens nothing either.
        let opened = !persistedRegions.panel.collapsed;
        const replayedRegions = earlyRegions.splice(0).reduce((r, change) => {
          const next = change(r);
          opened ||= !next.panel.collapsed;
          return next;
        }, persistedRegions);
        const restored = opened ? model.unfold(stored) : stored;
        const repaired = model.refile(model.repairMain(restored, known), setOfTab);
        let panelSurfaces = rememberSurfaceContext({ panelSurfaces: storedSurfaces, knownSession: known }, repaired);
        const repairedMain = replayed.reduce((m, change) => {
          const next = change(m);
          panelSurfaces = rememberSurfaceContext({ panelSurfaces, knownSession: known }, next);
          return next;
        }, repaired);
        panelSurfaces = earlySurfaces.splice(0).reduce((state, change) => change(state), panelSurfaces);
        // P4-B3x: a fold restored with its float stands; one whose float the reader dropped opens the panel it folded,
        // and one stored beside an open panel is dropped (both written back below).
        const { main: hydratedMain, regions: foldedRegions } = reconcileFold(restored, { main: repairedMain, regions: replayedRegions });
        const hydratedPins = pins(panelPinned, get().panelActiveNoSession ?? storedNoSession.activeTabId);
        const regions = surfaceRegions({ ...get(), main: hydratedMain, regions: foldedRegions, ...hydratedPins, panelBySession, panelSurfaces, hydrated: true });
        // P4-B3: the params of panel tabs no list holds now (closed, or a session's not kept) are not read; the
        // no-session selection is read back if it still names a pin.
        const live = livePanelTabIds(panelPinned, panelBySession);
        const panelParams = Object.fromEntries(Object.entries(storedParams.params).filter(([id]) => live.has(id)));
        set({ regions, main: hydratedMain, ...hydratedPins, panelBySession, panelParams, panelSurfaces, hydrated: true });
        // A first launch writes the defaults of the keys it lacks, so layout.json always holds the renderer's three
        // fixed keys (acceptance item 6 lists them). Tabs replayed over the saved ones differ from what layout.json holds,
        // and persistence takes the hydrated state as its baseline, so they are written here too. Everything after this
        // is written only when it changes. A version-1 `main.tabs` is written back filed by project (W12), since its
        // filing reads records that may differ at the next launch.
        // P4-B3 (its Decision Log 23, tracker row 126): a `main.tabs` the reader rewrote (a tab of an unknown or retired kind
        // dropped, a deliverable tab converted) is written back too, so its warning is said once and a later build's kind
        // read after a downgrade is gone from layout.json for good.
        const unsaved = new Set(absent);
        const rewritten = readAs.has('main.tabs') && !sameJson(readAs.get('main.tabs'), persistedMain);
        // P4-B3x: so is one whose fold hydration dropped, or the next launch would read the stale mark again (a float the
        // reader drops would reopen a panel the owner has since closed).
        const unfolded = model.foldOf(stored) !== null && model.foldOf(hydratedMain) === null;
        if (persistedMain.version === 1 || rewritten || unfolded || (replayed.length > 0 && JSON.stringify(hydratedMain) !== JSON.stringify(persistedMain))) unsaved.add('main.tabs');
        if (regions !== persistedRegions) unsaved.add('regions');
        if (!sameJson(panelSurfaces, storedSurfaces)) unsaved.add('panelTools.surfaces');
        const values: Partial<Record<LayoutKey, unknown>> = { regions, 'main.tabs': get().main, 'panel.pinned': panelPinned, 'panelTools.surfaces': panelSurfaces };
        for (const key of unsaved) {
          if (!(key in values)) continue;
          void client.invoke('layout.set', { key, value: values[key] }).then((result) => {
            if (!result.ok) console.error(`[layout] layout.set ${key} failed`, result.error);
          });
        }
      },

      openTab: (ref, opts) => main((m) => model.openTab(m, ref, { ...opts, set: setOfTab(ref) ?? undefined })),
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
        const inTheWay = (m: LayoutMain): TabRef | null => {
          if (opts.split || opts.how === 'tab' || model.isOpen(m, `session:${appSessionId}`)) return null;
          const to = setOfSession(appSessionId);
          const shown = model.activeTab(to === undefined ? m : model.switchSet(m, to));
          return shown !== null && !shown.pinned ? shown : null;
        };
        const verdictOf = (tab: TabRef | null): ReplaceVerdict => (tab === null ? null : (guard?.verdict?.(tab) ?? null));
        const draftInTheWay = (m: LayoutMain): Extract<TabRef, { kind: 'session' }> | null => {
          const shown = inTheWay(m);
          return shown?.kind === 'session' && guard !== null && guard.unstarted(shown.appSessionId) && verdictOf(shown) === null ? shown : null;
        };
        const kept = (m: LayoutMain) => {
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
        main((m) => {
          const restored = replayed ? inTheWay(m) : null;
          const restoredStays = restored !== null && (restored.kind !== 'session' || guard?.unstarted(restored.appSessionId) === true);
          const beside = kept(m) || restoredStays;
          replayed = true;
          return model.openSession(m, appSessionId, { ...opts, how: beside ? 'tab' : opts.how, set: setOfSession(appSessionId) });
        });
        if (shown !== null && verdict !== null) guard?.announce?.(shown, verdict);
        if (draft === null || guard === null) return;
        // A draft that started while its guard decided (its record arrived) is a live session now: its tabs, history and
        // panel stay.
        void guard.discard(draft).then((discarded) => {
          if (discarded && guard.unstarted(draft.appSessionId)) get().dropSession(draft.appSessionId);
        });
      },
      setCurrentProject: (projectId) => main((m) => model.switchSet(m, projectId ?? NO_PROJECT)),
      // Called on every records change, so nothing is set (and no subscriber woken) when nothing moves.
      refileTabs() {
        if (!get().hydrated) return;
        const next = model.refile(get().main, setOfTab);
        if (next !== get().main) commit(next, get().regions);
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
        main((m) => model.reopenClosed(m, at, setOfTab(last) ?? undefined));
      },
      moveTab: (id, toPane, index) => main((m) => model.moveTab(m, id, toPane, index)),
      reorderTab(id, index) {
        const pane = model.currentSet(get().main).panes.findIndex((p) => p.tabs.some((t) => t.id === id));
        if (pane !== -1) main((m) => model.moveTab(m, id, pane as Pane, index));
      },
      selectTab: (n) => main((m) => model.selectTab(m, n)),
      cycleTab: (delta) => main((m) => model.cycleTab(m, delta)),
      activateTab: (id) => main((m) => model.activateTab(m, id)),
      togglePinned: (id) => main((m) => model.togglePinned(m, id)),
      splitWithActive: () => main(model.splitWithActive),
      focusPane: (i) => main((m) => model.focusPane(m, i)),
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
          set({ panelBySession });
        }
      },

      setSidebar: (patch) => regions((r) => ({ ...r, sidebar: { ...r.sidebar, ...(typeof patch === 'function' ? patch(r.sidebar) : patch) } })),
      setPanel: (patch) => regions((r) => ({ ...r, panel: panelAfter(r.panel, patch) })),
      revealMain: () => regions((r) => (r.panel.maximized || r.panel.floating ? { ...r, panel: { ...r.panel, maximized: false, floating: false } } : r)),
      setFloatingCardSize(key, size) {
        regions((r) => {
          const state = get();
          const live = new Set([SUMMARY_CARD_KEY, ...livePanelTabIds(state.panelPinned, state.panelBySession), ...model.allTabs(state.main).map((t) => mainCardKey(t.id))]); // P4-B3: main keys
          const kept = Object.entries(r.floatingCard).filter(([k]) => k !== key && live.has(k));
          return { ...r, floatingCard: Object.fromEntries([...kept, [key, size]].slice(-FLOATING_CARD_SIZES_MAX)) };
        });
      },
      setOverviewOpen(overviewOpen) {
        // Overview lives over main, so opening it restores main, including when regions are still hydrating.
        if (overviewOpen) get().revealMain();
        set({ overviewOpen });
      },
      setOverviewRect: (overview) => regions((r) => ({ ...r, overview })),
      setPanelTabPinned(appSessionId, tabId, pinned) {
        const own = get().panelBySession.get(appSessionId) ?? { tabs: [], activeTabId: null };
        const panelBySession = new Map(get().panelBySession);
        if (pinned) {
          const tab = own.tabs.find((t) => t.id === tabId);
          if (!tab) return;
          panelBySession.set(appSessionId, { ...own, tabs: own.tabs.filter((t) => t.id !== tabId) });
          set({ ...pins([...get().panelPinned, { ...tab, pinned: true }]), panelBySession });
        } else {
          const tab = get().panelPinned.find((t) => t.id === tabId);
          if (!tab) return;
          panelBySession.set(appSessionId, { ...own, tabs: [...own.tabs, { ...tab, pinned: false }] });
          set({ ...pins(get().panelPinned.filter((t) => t.id !== tabId)), panelBySession });
        }
      },
      setPanelTabs(appSessionId, next) {
        const refsBefore = get().effectivePanelTabs(appSessionId);
        const activeBefore = appSessionId === null ? get().panelActiveNoSession : (get().panelBySession.get(appSessionId)?.activeTabId ?? null);
        const pinned = next.tabs.filter((t) => t.pinned);
        const panelBySession = new Map(get().panelBySession);
        if (appSessionId !== null) panelBySession.set(appSessionId, { tabs: next.tabs.filter((t) => !t.pinned), activeTabId: next.activeTabId });
        const selection = pins(pinned, appSessionId === null ? next.activeTabId : undefined);
        const active = appSessionId === null ? selection.panelActiveNoSession : next.activeTabId;
        const refs = surfaceRefs({ panelPinned: selection.panelPinned, panelBySession }, appSessionId);
        const scope = surfaceScope(appSessionId);
        const panelSurfaces = surfaces((state) => {
          const before = normalizeSurfaceStack(state.stacks[scope] ?? (activeBefore === null ? [] : [activeBefore]), refsBefore);
          const ids = stackAfterSelection(before.map((id) => refsBefore.find((tab) => tab.id === id)!), refs, active);
          if (sameJson(state.stacks[scope] ?? before, ids)) return state;
          return { ...state, stacks: { ...state.stacks, [scope]: ids } };
        });
        set({ ...selection, ...(appSessionId === null ? {} : { panelBySession }), panelSurfaces });
      },
      setSurfaceStack(appSessionId, requested) {
        const ids = normalizeSurfaceStack(requested, get().effectivePanelTabs(appSessionId));
        const activeTabId = ids.at(-1) ?? null;
        const panelBySession = new Map(get().panelBySession);
        if (appSessionId !== null) {
          const own = panelBySession.get(appSessionId) ?? { tabs: [], activeTabId: null };
          panelBySession.set(appSessionId, { ...own, activeTabId });
        }
        const scope = surfaceScope(appSessionId);
        const panelSurfaces = surfaces((state) => sameJson(state.stacks[scope], ids) ? state : { ...state, stacks: { ...state.stacks, [scope]: ids } });
        set({ ...(appSessionId === null ? { panelActiveNoSession: activeTabId } : { panelBySession }), panelSurfaces });
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
        const before = get().effectivePanelTabs(appSessionId);
        const after = fn(before);
        const current = get().panelBySession.get(appSessionId)?.activeTabId ?? null;
        get().setPanelTabs(appSessionId, { tabs: after, activeTabId: pinSelection(before, after, current, opts?.activeTabId ?? current) });
      },
      setPanelParams(tabId, params) {
        const held = get().panelParams;
        if (params === null ? !(tabId in held) : sameJson(held[tabId], params)) return;
        const live = livePanelTabIds(get().panelPinned, get().panelBySession);
        const kept = Object.entries(held).filter(([id]) => id !== tabId && live.has(id));
        set({ panelParams: Object.fromEntries(params === null ? kept : [...kept, [tabId, params]]) });
      },
      setDragging: (dragging) => set({ dragging }),
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
  ]);
  for (const [id, panel] of state.panelBySession) keys.set(`panel.${id}`, panel);
  return keys;
}

// The value a key's slice is written as: P4-B3's two keys wrap theirs in a versioned value, every other key is its slice.
// The sessions a tab holds open in any project's set: their own tab or an agent's (the tabs an archive closes).
const openSessionsOf = (main: LayoutMain): AppSessionId[] =>
  model.allTabs(main).flatMap((tab) => (tab.kind === 'session' || tab.kind === 'agent' ? [tab.appSessionId] : []));

function storedValue(key: LayoutKey, slice: unknown): unknown {
  if (key === 'panelTools.params') return { version: 1, params: slice };
  if (key === 'panelTools.activeNoSession') return { version: 1, activeTabId: slice };
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
    if (key === 'main.tabs') published = new Set(openSessionsOf(slice as LayoutMain));
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
    if (written) {
      for (const [key, value] of now) {
        if (written.get(key) === value) continue;
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
    written = now;
  });
  window.addEventListener('beforeunload', flush);
  return () => {
    unsubscribe();
    window.removeEventListener('beforeunload', flush);
    flush();
  };
}
