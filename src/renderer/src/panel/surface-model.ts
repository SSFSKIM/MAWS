// UX2-L: visible surfaces are a selection over the existing panel refs, never a second owner of tool instances.
import type { AppSessionId } from '@shared/graph/ids';
import type { LayoutMain, PanelSurfaces, PanelTabRef } from '@shared/ipc/schema/layout';
import type { LayoutState } from '../stores/layout';
import { activeTab, currentSet, sessionOfTab } from '../stores/layout-model';

type SurfaceState = Pick<LayoutState, 'panelPinned' | 'panelBySession' | 'panelActiveNoSession' | 'panelSurfaces'>;
export const surfaceScope = (session: AppSessionId | null): string => session ?? '@none';

type ContextState = Pick<LayoutState, 'main' | 'panelSurfaces' | 'knownSession'>;

export function surfaceSession(state: ContextState): AppSessionId | null {
  const active = sessionOfTab(activeTab(state.main));
  if (active !== null && state.knownSession(active)) return active;
  const sessions = currentSet(state.main).panes.flatMap((pane) => pane.tabs.flatMap((tab) => {
    const session = sessionOfTab(tab);
    return session !== null && state.knownSession(session) ? [session] : [];
  }));
  const remembered = state.panelSurfaces.contexts[state.main.current];
  return sessions.find((session) => session === remembered) ?? sessions[0] ?? null;
}

export function rememberSurfaceContext(state: Pick<ContextState, 'panelSurfaces' | 'knownSession'>, main: LayoutMain): PanelSurfaces {
  const session = sessionOfTab(activeTab(main));
  if (session === null || !state.knownSession(session) || state.panelSurfaces.contexts[main.current] === session) return state.panelSurfaces;
  return { ...state.panelSurfaces, contexts: { ...state.panelSurfaces.contexts, [main.current]: session } };
}

export function surfaceRefs(state: Pick<SurfaceState, 'panelPinned' | 'panelBySession'>, session: AppSessionId | null): PanelTabRef[] {
  return [...state.panelPinned, ...(session === null ? [] : (state.panelBySession.get(session)?.tabs ?? []))];
}

// Invalid/stale ids are ignored without rewriting saved scopes, so a temporarily unavailable context never resets it.
export function normalizeSurfaceStack(ids: readonly string[], refs: readonly PanelTabRef[]): string[] {
  const tools = new Set<string>();
  return ids.filter((id) => {
    const ref = refs.find((tab) => tab.id === id);
    if (!ref || tools.has(ref.toolId)) return false;
    tools.add(ref.toolId);
    return true;
  }).slice(0, 2);
}

export function surfaceTabs(state: SurfaceState, session: AppSessionId | null): PanelTabRef[] {
  const refs = surfaceRefs(state, session);
  const active = session === null ? state.panelActiveNoSession : (state.panelBySession.get(session)?.activeTabId ?? null);
  const ids = state.panelSurfaces.stacks[surfaceScope(session)] ?? (active === null ? [] : [active]);
  return normalizeSurfaceStack(ids, refs).map((id) => refs.find((tab) => tab.id === id)!);
}

// Selecting another tab of an open tool stays in its slot. A new tool fills the second slot, replacing only that
// bottom slot once both are occupied. Closing refs removes their slots; choosing summary clears both.
export function stackAfterSelection(before: readonly PanelTabRef[], refs: readonly PanelTabRef[], activeTabId: string | null): string[] {
  if (activeTabId === null) return [];
  const active = refs.find((tab) => tab.id === activeTabId);
  const stack = normalizeSurfaceStack(before.flatMap((tab) => {
    const replacement = active?.toolId === tab.toolId ? active : (refs.find((ref) => ref.id === tab.id) ?? refs.findLast((ref) => ref.toolId === tab.toolId));
    return replacement ? [replacement.id] : [];
  }), refs);
  if (!active || stack.includes(activeTabId)) return stack;
  return stack.length < 2 ? [...stack, activeTabId] : [stack[0], activeTabId];
}
