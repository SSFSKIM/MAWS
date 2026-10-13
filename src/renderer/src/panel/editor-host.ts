// X32, the editor host contract (the P3-G execution document §D2.3; ledger §5): what an editor body tells the header
// above it about itself, the same in a panel tab and in a main tab. One registration per scope, a scope being the tab
// the body renders in; a body learns its scope from context (`useEditorHostScope`: ToolBody provides the panel tab's,
// the main pane the main tab's) or, outside React, from `PanelToolContext.editorHost`. Today's tools register nothing
// and the header shows their strip label; P3-L, B, C, D and E register their editors here.
// A registration lives as long as its tab, not its mounted body (§D2.3, M3's review): only the active body is mounted,
// and an inactive tab's closeGuard must still veto its close, so a guard or an action reads the tab's own state (X5),
// never a body's component state. The panel host clears a scope when it disposes the tab's instance; a main tab's scope
// is cleared here when the tab leaves `main` (closed, replaced, dropped), whatever registered it.
import { createContext, useContext, useLayoutEffect, useRef, type ComponentType } from 'react';
import { create } from 'zustand';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';

export type SavedState = 'saved' | 'saving' | 'unsaved' | 'reconnecting' | 'readonly';
export interface EditorHostAction { id: string; label: string; icon?: ComponentType<{ className?: string }>; onSelect(): void; disabled?: boolean; pressed?: boolean }
export interface EditorHostExport { id: string; label: string; onSelect(): void; disabled?: boolean }
export interface EditorHostRegistration {
  title: string;
  breadcrumb?: readonly string[];
  saved?: SavedState | null; // absent or null: no indicator
  unresolved?: number; // 0 or absent: no count
  actions?: readonly EditorHostAction[]; // version history, Open in tab, comments, …
  exports?: readonly EditorHostExport[];
  closeGuard?: (() => Promise<boolean>) | null; // false keeps the tab open (the editor shows its own confirmation)
}
export type EditorHostScope = { surface: 'panel'; tabId: string } | { surface: 'main'; tabId: string };
export interface EditorHostHandle { update(patch: Partial<EditorHostRegistration>): void; dispose(): void }

// The header's copy for each saved state (Claude Desktop's words; `unsaved` is MAWS's "not yet saved").
export const SAVED_COPY: Record<SavedState, string> = {
  saved: 'All changes saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  reconnecting: 'Reconnecting…',
  readonly: 'Read-only',
};

const keyOf = (scope: EditorHostScope): string => `${scope.surface}:${scope.tabId}`;

// What the headers draw, by scope key; `tokens` names each scope's current registration, so a replaced or cleared
// registration's handle is recognised as stale. `unmounted` holds the tokens whose registering hook's body has unmounted
// (the tab is inactive): a registration replacing one of those is that tab's body remounting, not a second editor.
const useEditorHosts = create<{ entries: Readonly<Record<string, EditorHostRegistration>> }>()(() => ({ entries: {} }));
const tokens = new Map<string, symbol>();
const unmounted = new WeakSet<symbol>();

function write(key: string, registration: EditorHostRegistration | null): void {
  useEditorHosts.setState((s) => {
    const entries = { ...s.entries };
    if (registration) entries[key] = registration;
    else delete entries[key];
    return { entries };
  });
}

const sameFields = (a: EditorHostRegistration, b: EditorHostRegistration): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof EditorHostRegistration)[]);
  return [...keys].every((k) => a[k] === b[k]);
};

export function registerEditorHost(scope: EditorHostScope, host: EditorHostRegistration): EditorHostHandle {
  return register(scope, host).handle;
}

function register(scope: EditorHostScope, host: EditorHostRegistration): { handle: EditorHostHandle; token: symbol } {
  const key = keyOf(scope);
  const previous = tokens.get(key);
  if (previous && !unmounted.has(previous) && import.meta.env.DEV) console.warn(`[editor-host] a second registration for ${key} replaces the first`);
  const token = Symbol(key);
  tokens.set(key, token);
  write(key, { ...host });
  const live = () => tokens.get(key) === token;
  const handle: EditorHostHandle = {
    update(patch) {
      if (!live()) return;
      const current = useEditorHosts.getState().entries[key];
      const next = { ...current, ...patch };
      if (!sameFields(current, next)) write(key, next);
    },
    dispose() {
      if (!live()) return;
      tokens.delete(key);
      write(key, null);
    },
  };
  return { handle, token };
}

// The scope's registration goes and its handle with it: the tab itself went (the panel host disposing its instance, a
// main tab leaving `main`).
export function clearEditorHost(scope: EditorHostScope): void {
  const key = keyOf(scope);
  if (!tokens.delete(key)) return;
  write(key, null);
}

// Main tabs: a registration whose tab is in no pane of any project's tab set any more (closed, replaced by another
// session, dropped with its session) is cleared, whatever made it; a tab moving between panes or sets keeps it.
const MAIN_PREFIX = 'main:';
useLayout.subscribe((state, before) => {
  if (state.main === before.main) return;
  const stale = [...tokens.keys()].filter((key) => key.startsWith(MAIN_PREFIX));
  if (stale.length === 0) return;
  const open = new Set(allTabs(state.main).map((t) => t.id));
  for (const key of stale) if (!open.has(key.slice(MAIN_PREFIX.length))) clearEditorHost({ surface: 'main', tabId: key.slice(MAIN_PREFIX.length) });
});

export const editorHostOf = (scope: EditorHostScope): EditorHostRegistration | null => useEditorHosts.getState().entries[keyOf(scope)] ?? null;

export function useEditorHostRegistration(scope: EditorHostScope | null): EditorHostRegistration | null {
  const key = scope ? keyOf(scope) : null;
  return useEditorHosts((s) => (key === null ? null : (s.entries[key] ?? null)));
}

// Asked by both close paths before the tab's own guard: the registration's closeGuard answer, a guard that throws keeping
// the tab as the shell's kind guards do; null when the tab has no closeGuard, so a caller with nothing to ask awaits
// nothing and its own guard runs in the same tick as before X32.
export function askEditorHostClose(scope: EditorHostScope): Promise<boolean> | null {
  const guard = editorHostOf(scope)?.closeGuard;
  if (!guard) return null;
  return (async () => {
    try {
      return await guard();
    } catch (error) {
      console.error(`[editor-host] closeGuard for ${keyOf(scope)} failed; keeping the tab`, error);
      return false;
    }
  })();
}

export const EditorHostScopeContext = createContext<EditorHostScope | null>(null);

export const useEditorHostScope = (): EditorHostScope | null => useContext(EditorHostScopeContext);

// Every optional field named, so a render that drops one clears it from the registration.
const CLEARED: Partial<EditorHostRegistration> = { breadcrumb: undefined, saved: undefined, unresolved: undefined, actions: undefined, exports: undefined, closeGuard: undefined };

// Registers on mount, updates with each render's fields. The registration outlives the body: an unmount (a tab switch)
// keeps it for the tab, and the tab's body mounting again replaces it. A mounted body that changes its scope moves its
// registration (the old scope's goes); a null scope (rendered outside any tab, or an editor withdrawing) registers nothing.
export function useEditorHost(scope: EditorHostScope | null, host: EditorHostRegistration): void {
  const surface = scope?.surface ?? null;
  const tabId = scope?.tabId ?? null;
  const handle = useRef<EditorHostHandle | null>(null);
  const latest = useRef(host);
  useLayoutEffect(() => {
    latest.current = host;
    handle.current?.update({ ...CLEARED, ...host });
  });
  useLayoutEffect(() => {
    // A scope change while mounted: the body withdraws from the scope it registered under.
    handle.current?.dispose();
    handle.current = null;
    if (surface === null || tabId === null) return;
    const registered = register({ surface, tabId }, latest.current);
    handle.current = registered.handle;
    return () => {
      // Unmounting, or about to register again: the registration stays with the tab, marked as having no body.
      unmounted.add(registered.token);
    };
  }, [surface, tabId]);
}

// Tests: forget every registration.
export function resetEditorHosts(): void {
  tokens.clear();
  useEditorHosts.setState({ entries: {} });
}
