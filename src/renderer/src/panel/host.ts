// X5, canonical (C8a execution document, Interfaces *X5, canonical* and *The host's state and transitions*): the tool
// registry, the tab instances and every transition of the host's table that is not a fact about what the strip is
// about to show (those live in `PanelHost.tsx`). Two stores, deliberately split: the instance map is module state,
// never React state, so a tab's live state survives visibility, collapse, session switches under a pin and re-renders;
// `usePanelHost` carries only what React draws, with `version` bumped whenever the instance map changes.
//
// Refs are written only through C5's layout store: the shown session's list through the mounted host's `onChange`,
// another session's through `updatePanelTabs`, the pins alone through `setPanelTabs(null, …)`. Nothing is written before
// C5's hydration: an `addTool` made earlier is a pending add, applied when `hydrated` turns true (the barrier), because
// `hydrate` replaces the panel lists wholesale.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { LayoutMain, PanelTabRef } from '@shared/ipc/schema/layout';
import { currentTabRetention } from '../keymap/actions-runtime';
import { pinSelection, useLayout, type LayoutState } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { askEditorHostClose, clearEditorHost } from './editor-host'; // P3-G
import type { PanelHostProps } from './host-slot';
import type { PanelTool, PanelToolInit } from './tool';

type AnyTool = PanelTool<unknown, unknown>;

// `addTool`'s options (C9's name for the spec's inline type, adopted): `appSessionId` is the target session.
export interface AddToolOptions<P> {
  appSessionId: AppSessionId | null;
  params?: P;
  pin?: boolean;
  activate?: boolean;
}

export interface Instance {
  ref: PanelTabRef; // as created; the ref's `pinned` is read from the layout store, never from here
  tool: AnyTool; // the declaration it was created under (a re-registration of the same id replaces it)
  state: unknown;
  closing: Promise<boolean> | null;
}

interface QueuedOpen {
  appSessionId: AppSessionId | null;
  params: unknown;
  activate: boolean;
}

export interface PendingAdd {
  id: string;
  toolId: string;
  appSessionId: AppSessionId | null;
  params: unknown;
  pin: boolean;
  activate: boolean;
  opens: QueuedOpen[]; // later single-instance calls that resolved to this reservation, in call order
}

export interface PanelHostState {
  tools: Map<string, AnyTool>; // registration order
  titles: Record<string, string | null>; // setTitle suffixes by tab id
  focus: Record<string, number>; // focusRequest by tab id
  closing: Set<string>;
  version: number; // bumped when the instance map changes
}

const initialState = (): PanelHostState => ({ tools: new Map(), titles: {}, focus: {}, closing: new Set(), version: 0 });

export const usePanelHost = create<PanelHostState>()(initialState);

const instances = new Map<string, Instance>();
const registrations = new Map<string, symbol>(); // the current registration of each tool id
let pending: PendingAdd[] = [];
let restoredLogs = new Set<string>();
let barrierPassed = false; // the barrier runs once per module lifetime (an HMR reload of this file starts again)
// A pending add whose reservation landed on another tab at the barrier (two scopes' reservations of one single-instance
// tool meeting on one restored pin): its caller's id resolves to that tab.
const aliases = new Map<string, string>();
const resolveId = (tabId: string): string => aliases.get(tabId) ?? tabId;
let mounted: Pick<PanelHostProps, 'appSessionId' | 'onChange' | 'onTogglePinned'> | null = null;

const LOG_TOOL = 'log';

const layout = () => useLayout.getState();
const bump = () => usePanelHost.setState((s) => ({ version: s.version + 1 }));

// The session the panel shows, as C5's region derives it: the focused pane's active tab's session (a file tab's
// included). The one definition every module imports; `main` for a caller holding a layout state of its own.
export const shownSession = (main: LayoutMain = layout().main): AppSessionId | null => sessionOfTab(activeTab(main));

const selectionOf = (appSessionId: AppSessionId | null): string | null =>
  appSessionId === null ? layout().panelActiveNoSession : (layout().panelBySession.get(appSessionId)?.activeTabId ?? null);

// C5's own test for which sessions keep a layout list (`ipc/events.ts`, the predicate handed to `hydrate`).
const known = (appSessionId: AppSessionId): boolean =>
  useSessions.getState().records.has(appSessionId) || (currentTabRetention()?.retains(appSessionId) ?? false);

const allRefs = (state: LayoutState = layout()): PanelTabRef[] => [...state.panelPinned, ...[...state.panelBySession.values()].flatMap((s) => s.tabs)];

// ---- instances ---------------------------------------------------------------------------------------------------------

export const instanceOf = (tabId: string): Instance | undefined => instances.get(resolveId(tabId));
export const instanceIds = (): string[] => [...instances.keys()];

function createInstance(ref: PanelTabRef, tool: AnyTool, init: PanelToolInit<unknown>): Instance {
  const instance: Instance = { ref, tool, state: tool.createState(init), closing: null };
  instances.set(ref.id, instance);
  bump();
  return instance;
}

// A tab the strip shows for the first time: its state is created with the shown session and no params, marked restored
// (a restored tab, or a pinned one re-adopting at launch). Called by the host component; idempotent.
export function ensureShownInstances(tabs: PanelTabRef[], appSessionId: AppSessionId | null): void {
  const { tools } = usePanelHost.getState();
  for (const ref of tabs) {
    const tool = tools.get(ref.toolId);
    if (!tool || instances.has(ref.id)) continue;
    createInstance(ref, tool, { appSessionId, session: sessionRecord(appSessionId), instanceId: ref.id, params: undefined, restored: true });
  }
}

// Ensure-instance for a re-target: a restored ref whose list was never shown has none yet.
function ensureInstance(ref: PanelTabRef, tool: AnyTool, target: AppSessionId | null): Instance {
  return instances.get(ref.id) ?? createInstance(ref, tool, { appSessionId: target, session: sessionRecord(target), instanceId: ref.id, params: undefined, restored: true });
}

const sessionRecord = (appSessionId: AppSessionId | null) => (appSessionId === null ? null : (useSessions.getState().records.get(appSessionId) ?? null));

function disposeInstance(tabId: string): void {
  const instance = instances.get(tabId);
  if (!instance) return;
  instances.delete(tabId);
  try {
    instance.tool.dispose(instance.state);
  } catch (error) {
    console.error(`[panel] ${instance.tool.id} dispose failed`, error);
  }
  clearEditorHost({ surface: 'panel', tabId }); // P3-G: the tab's X32 registration lives until its instance goes
  usePanelHost.setState((s) => {
    const titles = { ...s.titles };
    const focus = { ...s.focus };
    delete titles[tabId];
    delete focus[tabId];
    const closing = new Set(s.closing);
    closing.delete(tabId);
    return { titles, focus, closing, version: s.version + 1 };
  });
}

// The strip's label for a tab, which the header shows too for a tool that registers nothing (P3-G §D2.3): the tool's
// title (a placeholder's tool id) and its `setTitle` suffix. A tab whose tool was unregistered while its veto kept it
// reads the declaration it was created under.
export function useTabLabel(tab: PanelTabRef): { tool: AnyTool | undefined; title: string; suffix: string | null } {
  const registered = usePanelHost((s) => s.tools.get(tab.toolId));
  const created = usePanelHost((s) => (s.version >= 0 ? instanceOf(tab.id)?.tool : undefined));
  const tool = registered ?? created;
  const suffix = usePanelHost((s) => s.titles[tab.id] ?? null);
  return { tool, title: tool?.title ?? tab.toolId, suffix };
}

export function setTitle(tabId: string, suffix: string | null): void {
  if ((usePanelHost.getState().titles[tabId] ?? null) === suffix) return;
  usePanelHost.setState((s) => ({ titles: { ...s.titles, [tabId]: suffix } }));
}

export function requestFocus(tabId: string): void {
  usePanelHost.setState((s) => ({ focus: { ...s.focus, [tabId]: (s.focus[tabId] ?? 0) + 1 } }));
}

function setClosing(tabId: string, on: boolean): void {
  usePanelHost.setState((s) => {
    const closing = new Set(s.closing);
    if (on) closing.add(tabId);
    else closing.delete(tabId);
    return { closing };
  });
}

// ---- writes through C5's store -----------------------------------------------------------------------------------------

// Writes one list: the pins alone (`null`) or a session's effective list, `fn` mapping it (the pins ride through). The
// selection becomes `requested` when it survives (null: the summary), else stays, else moves by the close rule.
function writeRefs(appSessionId: AppSessionId | null, fn: (refs: PanelTabRef[]) => PanelTabRef[], requested?: string | null): void {
  const l = layout();
  const before = appSessionId === null ? l.panelPinned : l.panelTabsOf(appSessionId);
  const after = fn(before);
  const current = selectionOf(appSessionId);
  const activeTabId = requested === null ? null : pinSelection(before, after, current, requested ?? current);
  if (appSessionId === null) l.setPanelTabs(null, { tabs: after, activeTabId });
  else if (mounted && mounted.appSessionId === appSessionId && shownSession() === appSessionId) mounted.onChange({ tabs: after, activeTabId });
  else if (requested === null) l.setPanelTabs(appSessionId, { tabs: after, activeTabId: null });
  else l.updatePanelTabs(appSessionId, fn, requested ? { activeTabId: requested } : undefined);
}

// The writer for a change to the pins alone: the shown session's list when it has one (so its selection is written
// with it), else the pins by themselves; no session gains a list for it.
function pinWriter(): AppSessionId | null {
  const shown = shownSession();
  return shown !== null && layout().panelBySession.has(shown) ? shown : null;
}

// Selection repair (C8a, *The host's state and transitions*): refs leaving a list every session shares (a pin closed,
// unpinned, unregistered or pruned) or changing id (a restored ref replaced at the barrier) leave other sessions'
// persisted selections naming them. Before `mutate`, each affected session's replacement is computed (the close rule
// over its effective list less `removed`, or `replacement`); `mutate` writes what it writes, passing a written
// session's replacement in that call (`replacementFor`) and returning the sessions it wrote; every other affected
// session then gets one identity `updatePanelTabs` carrying its replacement. The no-session selection is C5's on a
// removal (`pins()` revalidates it) and follows a replacement explicitly, since `pins()` would re-seat it on a neighbour.
function repairSelections(
  removed: ReadonlySet<string>,
  mutate: (replacementFor: (appSessionId: AppSessionId) => string | null | undefined) => Iterable<AppSessionId>,
  replacement?: string,
): void {
  const l = layout();
  const affected = new Map<AppSessionId, string | null>();
  for (const [appSessionId, state] of l.panelBySession) {
    if (state.activeTabId === null || !removed.has(state.activeTabId)) continue;
    const tabs = l.panelTabsOf(appSessionId);
    affected.set(appSessionId, replacement ?? pinSelection(tabs, tabs.filter((t) => !removed.has(t.id)), state.activeTabId));
  }
  const noSessionNamed = replacement !== undefined && l.panelActiveNoSession !== null && removed.has(l.panelActiveNoSession);
  const written = new Set(mutate((appSessionId) => affected.get(appSessionId)));
  for (const [appSessionId, next] of affected) {
    if (!written.has(appSessionId)) layout().updatePanelTabs(appSessionId, (refs) => refs, next === null ? undefined : { activeTabId: next });
  }
  if (noSessionNamed && layout().panelPinned.some((t) => t.id === replacement)) {
    layout().setPanelTabs(null, { tabs: layout().panelPinned, activeTabId: replacement });
  }
}

// Where a ref lives: the pins, or one session's own list.
function locate(tabId: string): { pinned: true } | { pinned: false; appSessionId: AppSessionId } | null {
  const l = layout();
  if (l.panelPinned.some((t) => t.id === tabId)) return { pinned: true };
  for (const [appSessionId, state] of l.panelBySession) if (state.tabs.some((t) => t.id === tabId)) return { pinned: false, appSessionId };
  return null;
}

// Removes refs from wherever each lives (the pins, or one session's own list), inside selection repair.
function removeRefs(ids: ReadonlySet<string>): void {
  const owners = new Set<AppSessionId | null>();
  for (const id of ids) {
    const at = locate(id);
    if (at) owners.add(at.pinned ? pinWriter() : at.appSessionId);
  }
  if (owners.size === 0) return;
  repairSelections(ids, (replacementFor) => {
    const written: AppSessionId[] = [];
    for (const owner of owners) {
      writeRefs(owner, (refs) => refs.filter((t) => !ids.has(t.id)), owner === null ? undefined : replacementFor(owner));
      if (owner !== null) written.push(owner);
    }
    return written;
  });
}

// W4: a tool added with `activate` is put on screen, so a hidden right panel (⌘⇧B) opens: the receipt's Review changes
// otherwise added an invisible tab. Opened after the selection is written, so the collapsed → open focus request
// (connectPanelHost) lands on the new tab. C10's attach opens it the same way (`sessions/attach.ts`).
function reveal(): void {
  if (layout().regions.panel.collapsed) layout().setPanel({ collapsed: false });
}

// Selects a tab in the target's list: the no-session selection for `null`; a session not on screen is opened in the
// main area first, so the panel follows.
function activateIn(target: AppSessionId | null, tabId: string): void {
  if (target === null) {
    writeRefs(null, (refs) => refs, tabId);
    if (shownSession() === null) requestFocus(tabId);
    reveal();
    return;
  }
  if (shownSession() !== target) layout().openSession(target);
  writeRefs(target, (refs) => refs, tabId);
  requestFocus(tabId);
  reveal();
}

// ---- tab ids -----------------------------------------------------------------------------------------------------------

function mintTabId(toolId: string): string {
  const taken = new Set([...allRefs().map((t) => t.id), ...instances.keys(), ...pending.map((p) => p.id)]);
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const id = `${toolId}:${Array.from(bytes, (b) => (b % 36).toString(36)).join('')}`;
    if (!taken.has(id)) return id;
  }
}

// ---- addTool -----------------------------------------------------------------------------------------------------------

// The refs a single-instance lookup reads: the target's list plus the pins, never another session's list.
const scopeRefs = (target: AppSessionId | null): PanelTabRef[] => (target === null ? layout().panelPinned : layout().panelTabsOf(target));

// The pre-hydration counterpart: a reservation in the same scope (targeting the same session unpinned, or any pin).
const inPendingScope = (entry: PendingAdd, target: AppSessionId | null) => entry.pin || (target !== null && entry.appSessionId === target);

interface Add {
  tool: AnyTool;
  target: AppSessionId | null;
  params: unknown;
  pin: boolean;
  activate: boolean;
}

// Opens an existing single-instance tab: its state first when it has none, then `open`, then the call's activation.
function retarget(ref: PanelTabRef, add: Add): string {
  const instance = ensureInstance(ref, add.tool, add.target);
  add.tool.open?.(instance.state, add.params);
  if (add.activate) activateIn(add.target, ref.id);
  return ref.id;
}

// One path for every add, now (after the barrier) or at the barrier: `id` is the reservation's when it was minted
// earlier, and `restored` the refs the barrier found, which a reservation may replace in place.
function applyAdd(add: Add, id?: string, restored?: ReadonlySet<string>): string {
  const { tool, target, params, pin, activate } = add;
  if (!tool.multiInstance) {
    const existing = scopeRefs(target).find((t) => t.toolId === tool.id);
    if (existing && id !== undefined && restored?.has(existing.id) && !instances.has(existing.id)) return replaceRestored(existing, add, id);
    if (existing) return retarget(existing, add);
  }
  const tabId = id ?? mintTabId(tool.id);
  const ref: PanelTabRef = { id: tabId, toolId: tool.id, pinned: pin };
  createInstance(ref, tool, { appSessionId: target, session: sessionRecord(target), instanceId: tabId, params });
  // The tab is written before its session is shown, so a synchronous reaction to that switch which adds the same
  // single-instance tool finds this tab rather than making a second one.
  writeRefs(target, (refs) => [...refs, ref], activate ? tabId : undefined);
  if (activate && target !== null && shownSession() !== target) layout().openSession(target);
  if (activate && (target !== null || shownSession() === null)) requestFocus(tabId);
  if (activate) reveal();
  return tabId;
}

// The barrier's in-place replacement: the reservation takes a restored, never-instantiated slot of its tool (position
// and `pinned` kept; `pin: true` on the call wins), and every selection that named the restored id migrates to it.
function replaceRestored(existing: PanelTabRef, add: Add, id: string): string {
  const ref: PanelTabRef = { id, toolId: add.tool.id, pinned: add.pin || existing.pinned };
  createInstance(ref, add.tool, { appSessionId: add.target, session: sessionRecord(add.target), instanceId: id, params: add.params });
  const owner = existing.pinned ? pinWriter() : add.target;
  repairSelections(
    new Set([existing.id]),
    (replacementFor) => {
      writeRefs(owner, (refs) => refs.map((t) => (t.id === existing.id ? ref : t)), owner === null ? undefined : replacementFor(owner));
      return owner === null ? [] : [owner];
    },
    id,
  );
  if (add.activate) activateIn(add.target, id);
  return id;
}

function addTool<P>(toolId: string, opts: AddToolOptions<P>): string {
  const tool = usePanelHost.getState().tools.get(toolId);
  if (!tool) throw new Error(`panel: no tool registered as ${toolId}`);
  const target = opts.appSessionId;
  const pin = opts.pin ?? false;
  const activate = opts.activate ?? true;
  if (target === null && !pin) throw new Error('panel: a tab with no session must be pinned');
  if (pin && !tool.pinnable) throw new Error(`panel: ${toolId} is not pinnable`);
  if (!layout().hydrated) {
    if (!tool.multiInstance) {
      const reserved = pending.find((p) => p.toolId === toolId && inPendingScope(p, target));
      if (reserved) {
        reserved.opens.push({ appSessionId: target, params: opts.params, activate });
        return reserved.id;
      }
    }
    const id = mintTabId(toolId);
    pending.push({ id, toolId, appSessionId: target, params: opts.params, pin, activate, opens: [] });
    return id;
  }
  return applyAdd({ tool, target, params: opts.params, pin, activate });
}

// ---- the barrier -------------------------------------------------------------------------------------------------------

function passBarrier(): void {
  barrierPassed = true;
  const l = layout();
  const restored = new Set(allRefs(l).map((t) => t.id));
  restoredLogs = new Set(allRefs(l).flatMap((t) => (t.toolId === LOG_TOOL ? [t.id] : [])));
  const entries = pending;
  pending = [];
  for (const entry of entries) {
    // A target C5's hydration would not keep a list for cancels the entry whole, its queued opens with it.
    if (entry.appSessionId !== null && !known(entry.appSessionId)) continue;
    const tool = usePanelHost.getState().tools.get(entry.toolId);
    if (!tool) continue; // unregistered while it waited
    const tabId = applyAdd({ tool, target: entry.appSessionId, params: entry.params, pin: entry.pin, activate: entry.activate }, entry.id, restored);
    if (tabId !== entry.id) aliases.set(entry.id, tabId);
    for (const queued of entry.opens) {
      if (queued.appSessionId !== null && !known(queued.appSessionId)) continue;
      const instance = instances.get(tabId);
      if (!instance) continue;
      tool.open?.(instance.state, queued.params);
      if (queued.activate) activateIn(queued.appSessionId, tabId);
    }
  }
}

// Reconciliation: an instance whose ref is in no list (a removed session's, through C5's `dropSession`) is disposed
// without `beforeClose`, since no ref remains for a veto to keep.
function reconcile(): void {
  const live = new Set(allRefs().map((t) => t.id));
  for (const id of [...instances.keys()]) if (!live.has(id)) disposeInstance(id);
}

// The store-driven transitions: the barrier on `hydrated`'s false → true edge, reconciliation, and the collapsed → open
// focus request. Mount once, after `persistLayout` has subscribed (the barrier's flush runs inside the hydration
// notification, and persistence baselines on the first hydrated state it hears).
export function connectPanelHost(): () => void {
  const off = useLayout.subscribe((state, prev) => {
    if (state.hydrated && !prev.hydrated) passBarrier();
    if (state.panelPinned !== prev.panelPinned || state.panelBySession !== prev.panelBySession) reconcile();
    if (prev.regions.panel.collapsed && !state.regions.panel.collapsed) {
      const selected = selectionOf(shownSession());
      if (selected !== null) requestFocus(selected);
    }
  });
  // Connected after hydration (an HMR reload of this module): the barrier runs now, once, so the restored-Log set is
  // captured and anything pending lands.
  if (layout().hydrated && !barrierPassed) passBarrier();
  return off;
}

// ---- the restored-Log prune ----------------------------------------------------------------------------------------------

export const isRestoredLog = (tabId: string): boolean => restoredLogs.has(tabId);
export const restoredLogIds = (): ReadonlySet<string> => restoredLogs;

// Called by the host component with the tabs it is about to show: drops restored Log refs before the strip renders
// them, written back once through `onChange` with the shown selection moved off them, inside selection repair (a pruned
// pinned Log leaves every session's list).
export function pruneRestoredLogs(props: Pick<PanelHostProps, 'appSessionId' | 'tabs' | 'activeTabId' | 'onChange'>): void {
  const pruned = new Set(props.tabs.flatMap((t) => (restoredLogs.has(t.id) ? [t.id] : [])));
  if (pruned.size === 0) return;
  for (const id of pruned) restoredLogs.delete(id);
  repairSelections(pruned, () => {
    const tabs = props.tabs.filter((t) => !pruned.has(t.id));
    props.onChange({ tabs, activeTabId: pinSelection(props.tabs, tabs, props.activeTabId) });
    return props.appSessionId === null ? [] : [props.appSessionId];
  });
}

// ---- the mounted host ----------------------------------------------------------------------------------------------------

// The host component's current props: the shown session's writer. Set from a layout effect.
export function setMountedHost(props: Pick<PanelHostProps, 'appSessionId' | 'onChange' | 'onTogglePinned'> | null): void {
  mounted = props;
}

// The pin glyph: C5 moves the ref between the lists; unpinning takes it out of every other session's list, so their
// selections are repaired.
export function togglePinned(id: string): void {
  const tabId = resolveId(id);
  const shown = shownSession();
  if (shown === null) return;
  const toggle = () => {
    if (mounted && mounted.appSessionId === shown) mounted.onTogglePinned(tabId);
    else {
      const tab = layout().panelTabsOf(shown).find((t) => t.id === tabId);
      if (tab) layout().setPanelTabPinned(shown, tabId, !tab.pinned);
    }
  };
  if (!layout().panelPinned.some((t) => t.id === tabId)) {
    toggle();
    return;
  }
  repairSelections(new Set([tabId]), () => {
    toggle();
    return [shown];
  });
}

// ---- registration and the public surface ---------------------------------------------------------------------------------

export function registerPanelTool<S, P>(tool: PanelTool<S, P>): () => void {
  const declared = tool as unknown as AnyTool;
  const token = Symbol(tool.id);
  registrations.set(tool.id, token);
  for (const instance of instances.values()) if (instance.tool.id === tool.id) instance.tool = declared;
  usePanelHost.setState((s) => ({ tools: new Map(s.tools).set(tool.id, declared), version: s.version + 1 }));
  return () => {
    if (registrations.get(tool.id) !== token) return;
    registrations.delete(tool.id);
    usePanelHost.setState((s) => {
      const tools = new Map(s.tools);
      tools.delete(tool.id);
      return { tools };
    });
    // Every ref of the tool closes as closeTab closes it: an instance asks `beforeClose` first (a veto keeps the tab,
    // rendered with the declaration it was created under); a ref with no instance goes as a placeholder does.
    const refs = allRefs().filter((t) => t.toolId === tool.id);
    const bare = new Set(refs.flatMap((t) => (instances.has(t.id) ? [] : [t.id])));
    removeRefs(bare);
    for (const ref of refs) if (!bare.has(ref.id)) void panelHost.closeTab(ref.id);
  };
}

export const panelHost = {
  addTool,
  // Selects the tab and, on screen, asks it to take the keyboard; `focus: false` selects it alone (a move the person did
  // not make, which leaves the keyboard where it is).
  selectTab(id: string, { focus = true }: { focus?: boolean } = {}): void {
    const tabId = resolveId(id);
    const at = locate(tabId);
    if (!at) return;
    const shown = shownSession();
    const owner = at.pinned ? shown : at.appSessionId;
    writeRefs(owner, (refs) => refs, tabId);
    if (focus && owner === shown) requestFocus(tabId);
    if (focus) reveal(); // opening a collapsed panel itself requests focus; passive roster changes must not do so
  },
  closeTab(id: string): Promise<boolean> {
    const tabId = resolveId(id);
    const instance = instances.get(tabId);
    if (!instance) {
      removeRefs(new Set([tabId]));
      return Promise.resolve(true);
    }
    if (instance.closing) return instance.closing;
    const closing = (async () => {
      let allowed = false;
      try {
        // P3-G (§D2.3): an editor's X32 closeGuard first; its veto stops before the tool is asked.
        const editor = askEditorHostClose({ surface: 'panel', tabId });
        allowed = (editor === null || (await editor)) && (await instance.tool.beforeClose(instance.state));
      } catch (error) {
        console.error(`[panel] ${instance.tool.id} beforeClose failed`, error);
      }
      if (instances.get(tabId) !== instance) return true; // reconciliation disposed it meanwhile
      instance.closing = null;
      if (!allowed) {
        setClosing(tabId, false);
        return false;
      }
      disposeInstance(tabId);
      removeRefs(new Set([tabId]));
      return true;
    })();
    instance.closing = closing;
    setClosing(tabId, true);
    return closing;
  },
  showSummary(): void {
    const shown = shownSession();
    if (selectionOf(shown) !== null) writeRefs(shown, (refs) => refs, null);
  },
  tools(): PanelTool<unknown, unknown>[] {
    return [...usePanelHost.getState().tools.values()];
  },
};

// Tests and the harness's debug strip.
export const pendingAdds = (): readonly PendingAdd[] => pending;

// Tests: forget every tool, instance and pending add without disposing anything.
export function resetPanelHost(): void {
  instances.clear();
  registrations.clear();
  pending = [];
  restoredLogs = new Set();
  barrierPassed = false;
  aliases.clear();
  mounted = null;
  usePanelHost.setState(initialState());
}
