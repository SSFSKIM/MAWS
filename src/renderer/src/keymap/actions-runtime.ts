// The handlers of the action table (C5 execution document, Keyboard runtime). `runAction` is the one entry point for
// menu events (`layout.action`), the ⌘K palette, the renderer's key dispatcher and every button that mirrors an
// action. C5 registers the shell's handlers; later children register theirs (C10 `session.new`). An action with no
// handler renders disabled everywhere: in the page through `useActionEnabled`, in the application menu through the
// enabled set the dispatcher reports to main.
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { LayoutMain, TabRef } from '@shared/ipc/schema/layout';
import type { ActionId } from '@shared/keymap/actions';
import type { Location } from '@shared/sessions/intent';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { createHandlerRegistry } from './registry';

export type ActionHandler = (arg: number | null) => void | Promise<void>;

const registry = createHandlerRegistry<ActionId, [number | null]>('actions');

export const registerAction = (id: ActionId, handler: ActionHandler): (() => void) => registry.register(id, handler);
export const runAction = (id: ActionId, arg: number | null = null): void => registry.run(id, arg);
export const isActionEnabled = (id: ActionId): boolean => registry.has(id);
export const enabledActions = (): ActionId[] => registry.ids();
export const subscribeActions = (listener: () => void): (() => void) => registry.subscribe(listener);
export const useActionEnabled = (id: ActionId): boolean => registry.useEnabled(id);

// ---- new sessions -------------------------------------------------------------------------------------------------------
// The owner's design (charter §19, 2026-09-28): no modal sheet. "+" and "New session" ask the registered creator for an
// app session id with a setup intent and no engine process (C10's `session.create`; in launch mode `scenario` the
// stub's), and the shell opens that unstarted session's tab. A project id cannot ride the numeric `layout.action` arg,
// so the "+" buttons call `createSession(projectId)` directly and C10's `session.new` handler calls it with null. W5: a
// worktree group's "+" in the sidebar names the checkout as the location, which the creator puts on the intent (a
// creator without intents ignores it).
export type SessionCreator = (projectId: ProjectId | null, location?: Location | null) => Promise<AppSessionId | null>;

const creators = createHandlerRegistry<'create', [ProjectId | null, (Location | null)?]>('session creator');

export const registerSessionCreator = (fn: SessionCreator): (() => void) => creators.register('create', fn);
export const isSessionCreatorRegistered = (): boolean => creators.has('create');
export const useSessionCreatorRegistered = (): boolean => creators.useEnabled('create');

// C12: answers the new session's id (null when none was made), so the Worktrees… dialog can set its location.
export async function createSession(projectId: ProjectId | null, opts: { pane?: 0 | 1 | 'focused'; location?: Location } = {}): Promise<AppSessionId | null> {
  const creator = creators.get('create') as SessionCreator | undefined;
  if (!creator) return null; // C12
  let appSessionId: AppSessionId | null;
  try {
    appSessionId = await (opts.location ? creator(projectId, opts.location) : creator(projectId));
  } catch (error) {
    console.error('[actions] session creator failed', error);
    return null; // C12
  }
  if (appSessionId === null) return null; // C12
  useSessions.getState().addUnstarted(appSessionId, { projectId, createdAt: new Date().toISOString() });
  useLayout.getState().openTab({ kind: 'session', appSessionId }, { pane: opts.pane ?? 'focused' });
  return appSessionId; // C12
}

// ---- closing tabs -------------------------------------------------------------------------------------------------------
// C10's ask of C5 (C5 execution document, Decision Log 2026-09-28): a guard per tab kind, asked before a tab of that
// kind closes; the tab closes only on true. C10 registers the `session` guard, which asks about a non-empty draft
// itself, so the shell shows no dialog of its own. Every close the user makes (the strip's control, a middle-click,
// Delete, ⌘W) goes through `requestCloseTab`; the layout store's `closeTab` stays the unguarded transition underneath.
export type CloseGuard = (ref: TabRef) => Promise<boolean>;

const closeGuards = createHandlerRegistry<TabRef['kind'], [TabRef]>('close guard');

export const registerCloseGuard = (kind: TabRef['kind'], guard: CloseGuard): (() => void) => closeGuards.register(kind, guard);

const findTab = (main: LayoutMain, id: string): TabRef | null => main.panes.flatMap((p) => p.tabs).find((t) => t.id === id) ?? null;

export async function requestCloseTab(id: string): Promise<void> {
  const ref = findTab(useLayout.getState().main, id);
  if (!ref || ref.kind === 'overview') return;
  const guard = closeGuards.get(ref.kind) as CloseGuard | undefined;
  if (guard) {
    let close: boolean;
    try {
      close = await guard(ref);
    } catch (error) {
      console.error(`[actions] close guard for ${ref.kind} failed; keeping the tab`, error);
      return;
    }
    if (!close) return;
  }
  // An unstarted session (no record yet) leaves nothing to reopen: its tab goes without a ⌘⇧T entry, and its intent
  // goes with it. Every other tab closes the ordinary way.
  if (ref.kind === 'session' && !useSessions.getState().records.has(ref.appSessionId)) {
    useLayout.getState().dropSession(ref.appSessionId);
    useSessions.getState().dropUnstarted(ref.appSessionId);
    return;
  }
  useLayout.getState().closeTab(id);
}

// ---- unstarted titles ---------------------------------------------------------------------------------------------------
// What the strip and the toolbar call a session tab with no record yet. C10 registers its `unstartedTitle` over its
// intent store; until then C5 answers from `sessions.unstarted`: "New session" and the project it was created in. The
// registered function is called during render and must not call hooks.
export type UnstartedTitle = (appSessionId: AppSessionId) => { title: string; project: string | null } | null;

const unstartedTitles = createHandlerRegistry<'title', [AppSessionId]>('unstarted title');

export const registerUnstartedTitle = (fn: UnstartedTitle): (() => void) => unstartedTitles.register('title', fn);

export function useUnstartedTitle(appSessionId: AppSessionId): { title: string; project: string | null } {
  const project = useSessions((s) => {
    const projectId = s.unstarted.get(appSessionId)?.projectId;
    return projectId ? (s.projects.get(projectId)?.name ?? null) : null;
  });
  const registered = unstartedTitles.useHandler('title') as UnstartedTitle | undefined;
  return registered?.(appSessionId) ?? { title: 'New session', project };
}

// ---- tab retention ------------------------------------------------------------------------------------------------------
// C10's seventh ask of C5: an unstarted session has no record, so without a say from C10 a relaunch would drop its tab
// (hydration keeps only tabs whose record exists) though its draft persists, and a rollback that removes a provisional
// record would close the tab before its failure card can offer recovery. C10 registers once: hydration waits for
// `ready` (its intent snapshot) and keeps a record-less session tab `retains` claims; `session.removed` closes a tab
// only when `retains` says no. Unregistered, the default rules stand.
export interface TabRetention {
  ready: Promise<void>;
  retains(appSessionId: string): boolean;
}

let retention: TabRetention | null = null;

export function registerTabRetention(r: TabRetention): () => void {
  retention = r;
  return () => {
    if (retention === r) retention = null;
  };
}

export const currentTabRetention = (): TabRetention | null => retention;
