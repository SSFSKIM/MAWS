// The session actions of §5.1 (open, open in split, pin, rename, fork, archive, delete conversation, remove worktree):
// one list for the toolbar's session menu and the sidebar's context menus, each entry enabled only while a handler is
// registered. C5 registers open, open in split and pin; C10 registers the rest (residue *Slots*: unregistered actions
// render disabled).
import type { AppSessionId } from '@shared/graph/ids';
import { createHandlerRegistry } from '../keymap/registry';

export const SESSION_ACTIONS = {
  open: 'Open',
  openInSplit: 'Open in split',
  pin: 'Pin',
  rename: 'Rename…',
  fork: 'Fork',
  archive: 'Archive',
  deleteConversation: 'Delete conversation…',
  removeWorktree: 'Remove worktree…',
} as const;
export type SessionActionId = keyof typeof SESSION_ACTIONS;
export const SESSION_ACTION_IDS = Object.keys(SESSION_ACTIONS) as SessionActionId[];

const registry = createHandlerRegistry<SessionActionId, [AppSessionId]>('session actions');

export const registerSessionAction = (id: SessionActionId, handler: (appSessionId: AppSessionId) => unknown): (() => void) =>
  registry.register(id, handler);
export const runSessionAction = (id: SessionActionId, appSessionId: AppSessionId): void => registry.run(id, appSessionId);
export const useSessionActionEnabled = (id: SessionActionId): boolean => registry.useEnabled(id);
