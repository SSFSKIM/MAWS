// Main's handlers for the record side of `session.*` (C4 execution document, M4): `session.list`, `session.get`,
// `session.update`, `session.projects.*` and `session.drafts.*`, answered from the index. A handler that throws becomes
// `internal` with the thrown message at the router (an unknown app session id, a read-only index, a bad directory).
import type { AppSessionId, MessageUuid, ProjectId } from '@shared/graph/ids';
import { readerStateOf, type SessionRecord } from '@shared/graph/session';
import type { Reader } from '@shared/ipc/client';
import type { ReaderPatch, SessionPatch } from '@shared/ipc/schema/session';
import type { ServicesBus } from '@shared/spine/bus';
import { setupAddFolder, thisGuard, type SetupGuard } from '../machine/setup';
import { addFolder } from './add-folder'; // New chat
import { locate } from './projects';
import type { Index } from './index';

// P5 O7 M9 round 2: a remote registration's `locate`, which never runs git (setup.ts answers its question first).
const setupLocate = (directory: string | null) => locate(directory, () => null);

// `setup` (P5 O7 M9): where a remote setup's registration is checked again (src/services/machine/setup.ts).
export function registerIndexHandlers(index: Index, { register }: Pick<ServicesBus, 'register'>, setup: SetupGuard = thisGuard()): void {
  register('session.search', ({ query, sessions }) => ({ hits: index.sessionSearch.search(query, undefined, sessions as AppSessionId[] | undefined), indexing: index.sessionSearch.indexing(), incomplete: index.sessionSearch.incomplete() }));
  // P5 O8 M6a (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §P): `context.reader` (the endpoint's,
  // written by mawsd's services front alone) routes the reads and the drafts to that reader's state; none is 'owner'.
  register('session.list', ({ includeArchived }, { reader }) => ({ sessions: index.sessions.list({ includeArchived }, reader), revision: index.revision }));
  // An app session id with no row (an unstarted tab) is an answer, not an error.
  register('session.get', ({ appSessionId }, { reader }) => index.sessions.get(appSessionId as AppSessionId, reader));
  register('session.update', ({ appSessionId, patch }, { reader }) => {
    // The whole record is this command's answer, and a reader must never be answered it (it holds paths, settings and a
    // spawn's signed act): a reader's update is `session.reader.update` (Decision Log, "M6a Task 1's fork")
    if (reader !== undefined) throw new Error('session.update takes no reader: a reader updates through session.reader.update');
    return applyPatch(index, appSessionId as AppSessionId, patch as SessionPatch);
  });
  // A member's write sends no session.changed and takes no revision (sessions.ts); the owners' does, as session.update's
  register('session.reader.update', ({ appSessionId, patch }, { reader }) => readerStateOf(index.transaction(() => applyReaderFields(index, appSessionId as AppSessionId, patch, reader ?? 'owner'))));
  // W11 (I5): hidden projects included, marked `hidden`, so the renderer keeps their sessions out of Other sessions
  register('session.projects.list', () => ({ projects: index.projects.listWithRemoved(), revision: index.revision, rows: index.projects.list({ includeHidden: true }) })); // P5 O3-D: every row too (D13)
  register('session.projects.add', ({ directory }) => index.projects.add(directory));
  // New chat: "Open folder…"; P5 O7 M9: another machine's owner's, claimed under `machine.op`, on the directory the
  // endpoint checked, checked again here before anything reads in it
  // (its linked-worktree answer read from git's files beforehand, so `setupLocate` asks no git: a miss would not fold)
  register('session.projects.addFolder', ({ directory, opened }, context) => (context.op === undefined ? addFolder(index.projects, directory) : setupAddFolder(directory, opened ?? [], setup, (checked, files) => addFolder(index.projects, checked, setupLocate, files))));
  register('session.projects.update', ({ id, patch }) => index.projects.update(id as ProjectId, patch));
  register('session.projects.remove', ({ id }) => index.projects.hide(id as ProjectId));
  register('session.drafts.get', ({ appSessionId }, { reader }) => index.drafts.get(appSessionId as AppSessionId, reader));
  register('session.drafts.set', ({ appSessionId, draft }, { reader }) => index.drafts.set(appSessionId as AppSessionId, draft, reader));
}

// `pinned` → setPinned; `lastSeen` (with or without `unread: false`, "Mark all read") → markSeen, which clears unread;
// `unread` alone → setUnread; `title` (the override of the Title rule) and `archived` → update. One transaction.
function applyPatch(index: Index, appId: AppSessionId, patch: SessionPatch): SessionRecord {
  return index.transaction(() => {
    let record = applyReaderFields(index, appId, patch, 'owner');
    if (patch.title !== undefined || patch.archived !== undefined) record = index.sessions.update(appId, { title: patch.title, archived: patch.archived });
    return record;
  });
}

// The reader fields of a patch, for `reader` (P5 O8 M6a), mapped as above; the record as that reader reads it. In the
// caller's transaction.
function applyReaderFields(index: Index, appId: AppSessionId, patch: ReaderPatch, reader: Reader): SessionRecord {
  let record = index.sessions.get(appId, reader);
  if (record === null) throw new Error(`unknown app session: ${appId}`);
  if (patch.pinned !== undefined) record = index.sessions.setPinned(appId, patch.pinned, reader);
  if (patch.lastSeen !== undefined) record = index.sessions.markSeen(appId, { messageUuid: patch.lastSeen.messageUuid as MessageUuid | null, at: patch.lastSeen.at }, reader);
  if (patch.unread !== undefined && !(patch.lastSeen !== undefined && !patch.unread)) record = index.sessions.setUnread(appId, patch.unread, reader);
  return record;
}
