// The handlers of the action table (C5 execution document, Keyboard runtime). `runAction` is the one entry point for
// menu events (`layout.action`), the ⌘K palette, the renderer's key dispatcher and every button that mirrors an
// action. C5 registers the shell's handlers; later children register theirs (C10 `session.new`). An action with no
// handler renders disabled everywhere: in the page through `useActionEnabled`, in the application menu through the
// enabled set the dispatcher reports to main.
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { LayoutMain, TabRef } from '@shared/ipc/schema/layout';
import type { ActionId } from '@shared/keymap/actions';
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
// so the "+" buttons call `createSession(projectId)` directly and C10's `session.new` handler calls it with null.
export type SessionCreator = (projectId: ProjectId | null) => Promise<AppSessionId | null>;

const creators = createHandlerRegistry<'create', [ProjectId | null]>('session creator');

export const registerSessionCreator = (fn: SessionCreator): (() => void) => creators.register('create', fn);
export const isSessionCreatorRegistered = (): boolean => creators.has('create');
export const useSessionCreatorRegistered = (): boolean => creators.useEnabled('create');

export async function createSession(projectId: ProjectId | null, opts: { pane?: 0 | 1 | 'focused' } = {}): Promise<void> {
  const creator = creators.get('create') as SessionCreator | undefined;
  if (!creator) return;
  let appSessionId: AppSessionId | null;
  try {
    appSessionId = await creator(projectId);
  } catch (error) {
    console.error('[actions] session creator failed', error);
    return;
  }
  if (appSessionId === null) return;
  useSessions.getState().addUnstarted(appSessionId, { projectId, createdAt: new Date().toISOString() });
  useLayout.getState().openTab({ kind: 'session', appSessionId }, { pane: opts.pane ?? 'focused' });
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
