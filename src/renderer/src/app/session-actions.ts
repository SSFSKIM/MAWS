// The session actions of §5.1 (open, open in new tab, open in split, pin, rename, fork, archive, delete conversation,
// remove worktree): one list for the toolbar's session menu and the sidebar's context menus, each entry enabled only
// while a handler is registered. C5 registers open, open in new tab, open in split and pin; C10 registers the rest
// (residue *Slots*: unregistered actions render disabled).
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { createHandlerRegistry } from '../keymap/registry';

export const SESSION_ACTIONS = {
  open: 'Open',
  // I2: Open replaces the focused pane's session; this keeps it and opens a tab of its own (Chrome's item)
  openInNewTab: 'Open in new tab',
  // C10 start: resume a session with no process (a foreign-live row never offers it; a MAWS-live one has nothing to resume)
  resume: 'Resume',
  // C10 end
  openInSplit: 'Open in split',
  pin: 'Pin',
  rename: 'Rename…',
  fork: 'Fork',
  // C10 start: the fork that creates a worktree first (the small sheet); `fork` above is the fork in place
  forkToWorktree: 'Fork to a new worktree…',
  // C10 end
  archive: 'Archive',
  deleteConversation: 'Delete conversation…',
  removeWorktree: 'Remove worktree…',
  // C10 start: a background job's session, opened in a terminal tab running the engine's `claude attach` (job holders only)
  attach: 'Attach in a terminal tab',
  // C10 end
  // P5 O9 M5 (the owner's Q4, as recommended): a terminal session MAWS drives through its bridge has no holder notice, so
  // its menu carries Take over, with today's confirm (it ends the terminal process; a turn in progress there is lost)
  takeOver: 'Take over in MAWS',
} as const;
export type SessionActionId = keyof typeof SESSION_ACTIONS;
export const SESSION_ACTION_IDS = Object.keys(SESSION_ACTIONS) as SessionActionId[];

// A session held by a terminal or a background job (D-12): shown with its holder, read-only.
function isForeign(record: SessionRecord): boolean {
  return record.holder.kind === 'terminal' || record.holder.kind === 'background_job';
}

// Today's rule for "Take over here" (`sessions/record-ops.ts` `canTakeOver`): an interactive terminal, or a job with an id.
const canTakeOver = (record: SessionRecord): boolean => record.holder.kind === 'terminal' || (record.holder.kind === 'background_job' && record.holder.jobId !== null);

// The actions a session's menus offer, whoever renders them (the sidebar's context menu and hover actions, the
// toolbar's session menu): a foreign-live session only the two opens, and "Remove worktree…" only with a worktree.
// P5 O9 M5: a foreign-live session MAWS drives through its bridge (`bridged`) shows no holder notice, so its menu adds
// what the notice carried: Take over in MAWS (where today's Take over applies) and Fork.
// P5 O7 M2: a lane B session on another machine (`remote`) only the opens: the record's writes, a fork, a delete and a
// worktree's removal are not offered over that machine's link (O7's Interfaces §L).
export function sessionActionsFor(record: SessionRecord, { bridged = false, remote = false }: { bridged?: boolean; remote?: boolean } = {}): SessionActionId[] {
  if (remote) return ['open', 'openInNewTab', 'openInSplit'];
  const notice: SessionActionId[] = bridged && isForeign(record) ? [...(canTakeOver(record) ? (['takeOver'] as const) : []), 'fork'] : [];
  // C10 start: a background job with a known id is attached beside the opens; nothing else holds a job to attach to
  if (record.holder.kind === 'background_job' && record.holder.jobId !== null) return ['open', 'openInNewTab', 'attach', ...notice];
  // C10 end
  if (isForeign(record)) return ['open', 'openInNewTab', ...notice];
  const offered = SESSION_ACTION_IDS.filter((id) => id !== 'removeWorktree' || record.worktree !== null);
  // C10 start: Attach is a job holder's alone (above); Resume only for a session no process holds (a MAWS-live one has
  // nothing to resume)
  offered.splice(offered.indexOf('attach'), 1);
  offered.splice(offered.indexOf('takeOver'), 1); // P5 O9 M5: a bridged foreign session's alone
  if (record.holder.kind === 'self') return offered.filter((id) => id !== 'resume');
  // C10 end
  return offered;
}

const registry = createHandlerRegistry<SessionActionId, [AppSessionId]>('session actions');

export const registerSessionAction = (id: SessionActionId, handler: (appSessionId: AppSessionId) => unknown): (() => void) =>
  registry.register(id, handler);
export const runSessionAction = (id: SessionActionId, appSessionId: AppSessionId): void => registry.run(id, appSessionId);
export const useSessionActionEnabled = (id: SessionActionId): boolean => registry.useEnabled(id);
