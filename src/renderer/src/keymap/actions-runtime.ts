// The handlers of the action table (C5 execution document, Keyboard runtime). `runAction` is the one entry point for
// menu events (`layout.action`), the ⌘K palette, the renderer's key dispatcher and every button that mirrors an
// action. C5 registers the shell's handlers; later children register theirs (C10 `session.new`). An action with no
// handler renders disabled everywhere: in the page through `useActionEnabled`, in the application menu through the
// enabled set the dispatcher reports to main.
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
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
