// UX2-L: visible surfaces are a selection over the existing panel refs, never a second owner of tool instances.
import type { AppSessionId } from '@shared/graph/ids';
import { NO_PROJECT, NO_SESSION_SCOPE, type LowerGroup, type PanelSurfaces, type PanelTabRef, type Strip } from '@shared/ipc/schema/layout';
import type { LayoutState } from '../stores/layout';
import { activeTab, currentSet, sessionOfTab } from '../stores/layout-model';

type SurfaceState = Pick<LayoutState, 'panelPinned' | 'panelBySession' | 'panelActiveNoSession' | 'panelSurfaces'>;
export const surfaceScope = (session: AppSessionId | null): string => session ?? NO_SESSION_SCOPE;

type ContextState = Pick<LayoutState, 'main' | 'panelSurfaces' | 'knownSession'>;

export function surfaceSession(state: ContextState): AppSessionId | null {
  const active = sessionOfTab(activeTab(state.main));
  if (active !== null && state.knownSession(active)) return active;
  const sessions = currentSet(state.main).panes.flatMap((pane) => pane.tabs.flatMap((tab) => {
    const session = sessionOfTab(tab);
    return session !== null && state.knownSession(session) ? [session] : [];
  }));
  const remembered = state.panelSurfaces.contexts[NO_PROJECT]; // U13a: the strip's one entry
  return sessions.find((session) => session === remembered) ?? sessions[0] ?? null;
}

export function rememberSurfaceContext(state: Pick<ContextState, 'panelSurfaces' | 'knownSession'>, main: Strip): PanelSurfaces {
  const session = sessionOfTab(activeTab(main));
  if (session === null || !state.knownSession(session) || state.panelSurfaces.contexts[NO_PROJECT] === session) return state.panelSurfaces;
  return { ...state.panelSurfaces, contexts: { ...state.panelSurfaces.contexts, [NO_PROJECT]: session } };
}

export function surfaceRefs(state: Pick<SurfaceState, 'panelPinned' | 'panelBySession'>, session: AppSessionId | null): PanelTabRef[] {
  return [...state.panelPinned, ...(session === null ? [] : (state.panelBySession.get(session)?.tabs ?? []))];
}

// Invalid/stale ids are ignored without rewriting saved scopes, so a temporarily unavailable context never resets it.
// UX wave U8b (§A, rule 1): a repeated id is dropped, two tabs of one tool may both be in view, and two ids at most.
export function normalizeSurfaceStack(ids: readonly string[], refs: readonly PanelTabRef[]): string[] {
  return [...new Set(ids)].filter((id) => refs.some((tab) => tab.id === id)).slice(0, 2);
}

// The tabs in view: none while the column is hidden, one, or two (one per group).
export function surfaceTabs(state: SurfaceState, session: AppSessionId | null): PanelTabRef[] {
  const refs = surfaceRefs(state, session);
  const active = session === null ? state.panelActiveNoSession : (state.panelBySession.get(session)?.activeTabId ?? null);
  const ids = state.panelSurfaces.stacks[surfaceScope(session)] ?? (active === null ? [] : [active]);
  return normalizeSurfaceStack(ids, refs).map((id) => refs.find((tab) => tab.id === id)!);
}

// ---- the side column's groups (UX wave U8b, docs/doperpowers/plans/2026-11-12-ux-wave-U8b-column-and-tabs.md, Interfaces
// §A and §B) ------------------------------------------------------------------------------------------------------------

// One strip with one tab in view under it. `tabs` in strip order (the scope's refs: the pins, then the session's own);
// `shown`: the tab in view, or the one to be when the column is shown again.
export interface SideGroup { tabs: PanelTabRef[]; shown: PanelTabRef | null }
export interface SideGroups { upper: SideGroup; lower: (SideGroup & { share: number }) | null; hidden: boolean }
export type SideGroupName = 'upper' | 'lower';
// What one scope stores of its column: `panelTools.surfaces.stacks[scope]`, the scope's `activeTabId` (a session's in
// `panel.<session>`, `@none`'s in `panelTools.activeNoSession`) and its entry of `panelTools.groups`.
export interface ScopeValues { stack: string[] | undefined; activeTabId: string | null; lower: LowerGroup | undefined }

export const SHARE_MIN = 0.2;
export const SHARE_MAX = 0.8;
export const clampShare = (share: number): number => Math.min(SHARE_MAX, Math.max(SHARE_MIN, share));

type GroupState = SurfaceState & Pick<LayoutState, 'panelGroups'>;

export function scopeValues(state: GroupState, session: AppSessionId | null): ScopeValues {
  const scope = surfaceScope(session);
  return {
    stack: state.panelSurfaces.stacks[scope],
    activeTabId: session === null ? state.panelActiveNoSession : (state.panelBySession.get(session)?.activeTabId ?? null),
    lower: state.panelGroups.lower[scope],
  };
}

// §A's reading rule over one scope's refs and stored values, whoever wrote them (this build, or build F in between).
export function readGroups(refs: readonly PanelTabRef[], { stack, activeTabId, lower }: ScopeValues): SideGroups {
  const byId = new Map(refs.map((tab) => [tab.id, tab]));
  const one = (shown: PanelTabRef | null, hidden: boolean): SideGroups => ({ upper: { tabs: [...refs], shown }, lower: null, hidden });
  const two = (lowerIds: readonly string[], upper: PanelTabRef, below: PanelTabRef, hidden: boolean): SideGroups => {
    const members = new Set(lowerIds);
    return {
      upper: { tabs: refs.filter((tab) => !members.has(tab.id)), shown: upper },
      lower: { tabs: refs.filter((tab) => members.has(tab.id)), shown: below, share: clampShare(lower?.share ?? 0.5) },
      hidden,
    };
  };
  // 1. The stored stack less ids that are no tab and repeated ids, cut to two (two tabs of one tool may both stand).
  const inView = [...new Set(stack ?? [])].filter((id) => byId.has(id)).slice(0, 2);
  // 2. Two ids: two groups, the lower one holding the second and the stored lower tabs that are still tabs.
  if (inView.length === 2) {
    const [above, below] = inView;
    return two([below, ...(lower?.tabs ?? []).filter((id) => byId.has(id) && id !== above && id !== below)], byId.get(above)!, byId.get(below)!, false);
  }
  // 3. One id: one group with every tab; a stored lower entry is dropped.
  if (inView.length === 1) return one(byId.get(inView[0])!, false);
  const active = activeTabId === null ? null : (byId.get(activeTabId) ?? null);
  // 4. No stack stored (a scope from before stacks were): the selection is in view, as it was then.
  if (stack === undefined) return one(active, active === null);
  // 5. Otherwise the column is hidden; what it shows when shown again.
  const lowerIds = [...new Set(lower?.tabs ?? [])].filter((id) => byId.has(id));
  const upperTabs = refs.filter((tab) => !lowerIds.includes(tab.id));
  if (lowerIds.length > 0 && upperTabs.length > 0) {
    const upper = active !== null && !lowerIds.includes(active.id) ? active : upperTabs[0];
    return two(lowerIds, upper, byId.get(lowerIds[0])!, true);
  }
  return one(active, true);
}

export function sideGroups(state: GroupState, session: AppSessionId | null): SideGroups {
  return readGroups(surfaceRefs(state, session), scopeValues(state, session));
}

export function groupOf(groups: SideGroups, tabId: string): 'upper' | 'lower' | null {
  if (groups.upper.tabs.some((tab) => tab.id === tabId)) return 'upper';
  return groups.lower?.tabs.some((tab) => tab.id === tabId) ? 'lower' : null;
}

// Where a tab that is opened goes while there are two groups: `origin` when the opener gave one, else the group that
// already holds a tab of its tool, else `focused` (the group that holds the keyboard, when known), else 'upper'.
export function groupForOpen(groups: SideGroups, toolId: string, origin: 'upper' | 'lower' | null, focused: 'upper' | 'lower' | null): 'upper' | 'lower' {
  if (groups.lower === null) return 'upper';
  if (origin !== null) return origin;
  if (groups.upper.tabs.some((tab) => tab.toolId === toolId)) return 'upper';
  if (groups.lower.tabs.some((tab) => tab.toolId === toolId)) return 'lower';
  return focused ?? 'upper';
}

// A scope's values with `ids` among its lower group's tabs, when it has a lower group (shown, or remembered while the
// column is hidden); as they were otherwise. The store's placement of refs an opener wrote for the lower group (M3).
export function joinLower(values: ScopeValues, ids: readonly string[]): ScopeValues {
  const lower = values.lower;
  const joining = lower === undefined ? [] : ids.filter((id) => !lower.tabs.includes(id));
  return lower === undefined || joining.length === 0 ? values : { ...values, lower: { ...lower, tabs: [...lower.tabs, ...joining] } };
}

// The stored lower entry of a lower group: the tab in view first, then its other tabs in the order the previous entry
// held them, then any others in strip order.
export function lowerEntry(shown: PanelTabRef, tabs: readonly PanelTabRef[], share: number, previous?: readonly string[]): LowerGroup {
  const members = new Set(tabs.map((tab) => tab.id));
  const kept = (previous ?? []).filter((id) => id !== shown.id && members.has(id));
  const rest = tabs.flatMap((tab) => (tab.id === shown.id || kept.includes(tab.id) ? [] : [tab.id]));
  return { tabs: [shown.id, ...kept, ...rest], share: clampShare(share) };
}

// The stored values that read back as `groups` (§A's table): `stack` none while hidden, else the tabs in view;
// `activeTabId` the upper (or only) group's tab in view, kept while hidden; a lower entry only with a lower group.
// `unstacked`: the scope stored no stack (rule 4), which a shown column with one group keeps.
export function valuesOf(groups: SideGroups, unstacked: boolean, previousLower?: readonly string[]): ScopeValues {
  const upper = groups.upper.shown;
  const lower = groups.lower !== null && groups.lower.shown !== null && upper !== null
    ? lowerEntry(groups.lower.shown, groups.lower.tabs, groups.lower.share, previousLower)
    : undefined;
  const empty = unstacked ? undefined : [];
  if (groups.hidden || upper === null) return { stack: empty, activeTabId: upper?.id ?? null, lower };
  if (lower !== undefined) return { stack: [upper.id, lower.tabs[0]], activeTabId: upper.id, lower };
  return { stack: unstacked ? undefined : [upper.id], activeTabId: upper.id, lower: undefined };
}

// One scope's stored values after its refs went from `before.refs` to `refs`, by any writer (Decision 5 of M1): a tab
// in view that is no longer a ref gives way to the next tab to its right in its group, else the group's last one; a group
// left with no tab closes (the other is then the only one); `renamed` maps an id the host replaced in place, which keeps
// its place. A column that was hidden stays hidden; one that was shown is not hidden by it. A ref that is new joins the
// upper group (an opener that wants it below says so to the store, which then places it with `joinLower`).
export function repairScope(before: ScopeValues & { refs: readonly PanelTabRef[] }, refs: readonly PanelTabRef[], renamed?: ReadonlyMap<string, string>): ScopeValues {
  const rename = (id: string) => renamed?.get(id) ?? id;
  const previous = readGroups(before.refs.map((tab) => ({ ...tab, id: rename(tab.id) })), {
    stack: before.stack?.map(rename),
    activeTabId: before.activeTabId === null ? null : rename(before.activeTabId),
    lower: before.lower && { ...before.lower, tabs: before.lower.tabs.map(rename) },
  });
  const now = new Map(refs.map((tab) => [tab.id, tab]));
  const below = new Set((previous.lower?.tabs ?? []).flatMap((tab) => (now.has(tab.id) ? [tab.id] : [])));
  const upperTabs = refs.filter((tab) => !below.has(tab.id));
  const lowerTabs = refs.filter((tab) => below.has(tab.id));
  const survivor = (group: SideGroup, members: readonly PanelTabRef[]): PanelTabRef | null => {
    if (group.shown === null) return null;
    const ids = new Set(members.map((tab) => tab.id));
    if (ids.has(group.shown.id)) return now.get(group.shown.id)!;
    const right = group.tabs.slice(group.tabs.findIndex((tab) => tab.id === group.shown!.id) + 1).find((tab) => ids.has(tab.id));
    return right ? now.get(right.id)! : (members.at(-1) ?? null);
  };
  const unstacked = before.stack === undefined;
  const one = (tabs: PanelTabRef[], shown: PanelTabRef | null): SideGroups => ({ upper: { tabs, shown }, lower: null, hidden: previous.hidden });
  let groups: SideGroups;
  if (previous.lower === null || lowerTabs.length === 0) groups = one([...refs], survivor(previous.upper, upperTabs));
  else if (upperTabs.length === 0) groups = one([...refs], survivor(previous.lower, lowerTabs));
  else groups = {
    upper: { tabs: upperTabs, shown: survivor(previous.upper, upperTabs) },
    lower: { tabs: lowerTabs, shown: survivor(previous.lower, lowerTabs), share: previous.lower.share },
    hidden: previous.hidden,
  };
  return valuesOf(groups, unstacked, before.lower?.tabs.map(rename));
}
