// The layout store (C5 execution document, Renderer stores; §4.1: layout state lives in the renderer, persistence is
// main's through `layout.*`). The four persisted keys plus transient drag and focus state. The tab and pane transitions
// are the pure functions of `layout-model.ts`; this store holds their result. Hydration reads each key, validates it
// against C5's shapes (an absent or invalid value falls back to its default) and repairs `main.tabs` against the
// sessions that exist. `persistLayout` writes each changed key back through `layout.set`, 250 ms after its last change
// and on `beforeunload`.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import {
  LAYOUT_DEFAULTS,
  LayoutMainSchema,
  LayoutRegionsSchema,
  PanelPinnedSchema,
  PanelSessionStateSchema,
  type LayoutKey,
  type LayoutMain,
  type LayoutRegions,
  type PanelSessionState,
  type PanelTabRef,
  type TabTarget,
} from '@shared/ipc/schema/layout';
import type * as z from 'zod';
import * as model from './layout-model';

type Pane = 0 | 1;

export interface LayoutState {
  regions: LayoutRegions;
  main: LayoutMain;
  panelPinned: PanelTabRef[];
  panelBySession: Map<AppSessionId, PanelSessionState>;
  hydrated: boolean;
  dragging: { tabId: string; fromPane: Pane } | null;
  focusedCardAppId: AppSessionId | null;
  hydrate(client: MawsBridge, known: (appSessionId: AppSessionId) => boolean): Promise<void>;
  openTab(ref: TabTarget, opts?: { pane?: model.PaneTarget; activate?: boolean }): void;
  openSession(appSessionId: AppSessionId, opts?: { split?: boolean }): void;
  closeTab(id: string): void;
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
  dropSession(appSessionId: AppSessionId): void; // session.removed
  setSidebar(patch: Partial<LayoutRegions['sidebar']>): void;
  setPanel(patch: Partial<LayoutRegions['panel']>): void;
  setPanelTabPinned(appSessionId: AppSessionId, tabId: string, pinned: boolean): void;
  // The panel host's `onChange` (PanelHostProps): pinned refs go to `panel.pinned` (D-10), the rest to the session's own
  // key; with no session only the pins are kept.
  setPanelTabs(appSessionId: AppSessionId | null, next: PanelSessionState): void;
  effectivePanelTabs(appSessionId: AppSessionId | null): PanelTabRef[]; // panelPinned first, then the session's own
  setDragging(dragging: LayoutState['dragging']): void;
  focusCard(appSessionId: AppSessionId | null): void;
}

const PANEL_KEY = /^panel\.([^.]+)$/;

export function createLayoutStore() {
  // Where each closed tab stood, so ⌘⇧T puts it back there (transient: `closedTabs` persists refs only).
  const closedAt = new Map<string, number>();

  return create<LayoutState>()((set, get) => {
    const main = (next: (m: LayoutMain) => LayoutMain) => set({ main: next(get().main) });
    return {
      regions: LAYOUT_DEFAULTS.regions,
      main: LAYOUT_DEFAULTS.main,
      panelPinned: LAYOUT_DEFAULTS.panelPinned,
      panelBySession: new Map(),
      hydrated: false,
      dragging: null,
      focusedCardAppId: null,

      async hydrate(client, known) {
        const read = async <T>(key: LayoutKey, schema: z.ZodType<T>, fallback: T): Promise<T> => {
          const result = await client.invoke('layout.get', { key });
          if (!result.ok) {
            console.error(`[layout] layout.get ${key} failed`, result.error);
            return fallback;
          }
          if (result.value.value === null) return fallback;
          const parsed = schema.safeParse(result.value.value);
          if (!parsed.success) console.warn(`[layout] ${key} is not a valid value; using the default`);
          return parsed.success ? parsed.data : fallback;
        };
        const listed = await client.invoke('layout.list', undefined);
        const panelIds = listed.ok
          ? listed.value.keys.flatMap((key) => {
              const match = PANEL_KEY.exec(key);
              return match && key !== 'panel.pinned' ? [match[1] as AppSessionId] : [];
            })
          : [];
        const [regions, persistedMain, panelPinned, ...panels] = await Promise.all([
          read('regions', LayoutRegionsSchema, LAYOUT_DEFAULTS.regions),
          read('main.tabs', LayoutMainSchema, LAYOUT_DEFAULTS.main),
          read('panel.pinned', PanelPinnedSchema, LAYOUT_DEFAULTS.panelPinned),
          ...panelIds.map((id) => read(`panel.${id}`, PanelSessionStateSchema.nullable(), null)),
        ]);
        const panelBySession = new Map<AppSessionId, PanelSessionState>();
        panelIds.forEach((id, i) => {
          const state = panels[i];
          if (state && known(id)) panelBySession.set(id, state);
        });
        set({ regions, main: model.repairMain(persistedMain, known), panelPinned, panelBySession, hydrated: true });
      },

      openTab: (ref, opts) => main((m) => model.openTab(m, ref, opts)),
      openSession: (appSessionId, opts) => main((m) => model.openSession(m, appSessionId, opts)),
      closeTab(id) {
        const pane = get().main.panes.find((p) => p.tabs.some((t) => t.id === id));
        if (pane && id !== 'overview') closedAt.set(id, pane.tabs.findIndex((t) => t.id === id));
        main((m) => model.closeTab(m, id));
      },
      reopenClosed() {
        const last = get().main.closedTabs.at(-1);
        if (!last) return;
        const at = closedAt.get(last.id) ?? null;
        closedAt.delete(last.id);
        main((m) => model.reopenClosed(m, at));
      },
      moveTab: (id, toPane, index) => main((m) => model.moveTab(m, id, toPane, index)),
      reorderTab(id, index) {
        const pane = get().main.panes.findIndex((p) => p.tabs.some((t) => t.id === id));
        if (pane !== -1) main((m) => model.moveTab(m, id, pane as Pane, index));
      },
      selectTab: (n) => main((m) => model.selectTab(m, n)),
      cycleTab: (delta) => main((m) => model.cycleTab(m, delta)),
      activateTab: (id) => main((m) => model.activateTab(m, id)),
      togglePinned: (id) => main((m) => model.togglePinned(m, id)),
      splitWithActive: () => main(model.splitWithActive),
      focusPane: (i) => main((m) => model.focusPane(m, i)),
      setSplitRatio: (r) => main((m) => model.setSplitRatio(m, r)),
      dropSession(appSessionId) {
        main((m) => model.dropSession(m, appSessionId));
        if (get().panelBySession.has(appSessionId)) {
          const panelBySession = new Map(get().panelBySession);
          panelBySession.delete(appSessionId);
          set({ panelBySession });
        }
      },

      setSidebar: (patch) => set({ regions: { ...get().regions, sidebar: { ...get().regions.sidebar, ...patch } } }),
      setPanel: (patch) => set({ regions: { ...get().regions, panel: { ...get().regions.panel, ...patch } } }),
      setPanelTabPinned(appSessionId, tabId, pinned) {
        const own = get().panelBySession.get(appSessionId) ?? { tabs: [], activeTabId: null };
        const panelBySession = new Map(get().panelBySession);
        if (pinned) {
          const tab = own.tabs.find((t) => t.id === tabId);
          if (!tab) return;
          panelBySession.set(appSessionId, { ...own, tabs: own.tabs.filter((t) => t.id !== tabId) });
          set({ panelPinned: [...get().panelPinned, { ...tab, pinned: true }], panelBySession });
        } else {
          const tab = get().panelPinned.find((t) => t.id === tabId);
          if (!tab) return;
          panelBySession.set(appSessionId, { ...own, tabs: [...own.tabs, { ...tab, pinned: false }] });
          set({ panelPinned: get().panelPinned.filter((t) => t.id !== tabId), panelBySession });
        }
      },
      setPanelTabs(appSessionId, next) {
        const panelPinned = next.tabs.filter((t) => t.pinned);
        if (appSessionId === null) {
          set({ panelPinned });
          return;
        }
        const panelBySession = new Map(get().panelBySession);
        panelBySession.set(appSessionId, { tabs: next.tabs.filter((t) => !t.pinned), activeTabId: next.activeTabId });
        set({ panelPinned, panelBySession });
      },
      effectivePanelTabs(appSessionId) {
        const own = appSessionId === null ? [] : (get().panelBySession.get(appSessionId)?.tabs ?? []);
        return [...get().panelPinned, ...own];
      },
      setDragging: (dragging) => set({ dragging }),
      focusCard: (appSessionId) => set({ focusedCardAppId: appSessionId }),
    };
  });
}

export const useLayout = createLayoutStore();

// ---- persistence ------------------------------------------------------------------------------------------------------

export const LAYOUT_WRITE_DELAY_MS = 250;

// Each persisted key and the state slice it holds; a slice is replaced (never mutated) when it changes.
function persistedKeys(state: LayoutState): Map<LayoutKey, unknown> {
  const keys = new Map<LayoutKey, unknown>([
    ['regions', state.regions],
    ['main.tabs', state.main],
    ['panel.pinned', state.panelPinned],
  ]);
  for (const [id, panel] of state.panelBySession) keys.set(`panel.${id}`, panel);
  return keys;
}

// Writes each changed key through `layout.set`, 250 ms after that key's last change, and every pending key at once on
// `beforeunload` and on stop. Nothing is written before hydration (the persisted values are not known yet, so a write
// would clobber them) or for hydration itself.
export function persistLayout(client: MawsBridge, store = useLayout): () => void {
  const pending = new Map<LayoutKey, { timer: ReturnType<typeof setTimeout>; value: unknown }>();
  let written: Map<LayoutKey, unknown> | null = store.getState().hydrated ? persistedKeys(store.getState()) : null;

  const write = (key: LayoutKey, value: unknown) => {
    void client.invoke('layout.set', { key, value }).then((result) => {
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
    if (written) for (const [key, value] of now) if (written.get(key) !== value) schedule(key, value);
    written = now;
  });
  window.addEventListener('beforeunload', flush);
  return () => {
    unsubscribe();
    window.removeEventListener('beforeunload', flush);
    flush();
  };
}
