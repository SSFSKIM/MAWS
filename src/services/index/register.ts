// Main's handlers for the record side of `session.*` (C4 execution document, M4): `session.list`, `session.get`,
// `session.update`, `session.projects.*` and `session.drafts.*`, answered from the index. A handler that throws becomes
// `internal` with the thrown message at the router (an unknown app session id, a read-only index, a bad directory).
import type { AppSessionId, MessageUuid, ProjectId } from '@shared/graph/ids';
import { readerStateOf, type SessionRecord } from '@shared/graph/session';
import type { Reader } from '@shared/ipc/client';
import type { ReaderPatch, SessionPatch } from '@shared/ipc/schema/session';
import type { ServicesBus } from '@shared/spine/bus';
import { rowFiles, setupGuarded, thisGuard, type SetupGuard } from '../machine/setup';
import { locate } from './projects';
import type { Index } from './index';
import { draftForLink, restoreWithheld } from '@shared/sessions/draft-fit'; // P5 O8 M6a

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
    const app = appSessionId as AppSessionId;
    if (reader === undefined) return applyPatch(index, app, patch as SessionPatch);
    // The whole record is this command's answer, and a reader must never be answered the owners' reading of it: a
    // reader's update is `session.reader.update` (Decision Log, "M6a Task 1's fork"). The UX wave (U9, R9, as amended
    // there): an unarchive is the one a reader may make, its patch checked here whatever the endpoint admitted, and it is
    // answered with the record as `session.get` answers that reader, read after the write, never `applyPatch`'s.
    if (!isUnarchive(patch)) throw new Error('session.update takes no reader but for an unarchive: a reader updates through session.reader.update');
    index.transaction(() => index.sessions.update(app, { archived: false }));
    const record = index.sessions.get(app, reader);
    if (record === null) throw new Error(`unknown app session: ${app}`);
    return record;
  });
  // A member's write sends no session.changed and takes no revision (sessions.ts); the owners' does, as session.update's
  register('session.reader.update', ({ appSessionId, patch }, { reader }) => readerStateOf(index.transaction(() => applyReaderFields(index, appSessionId as AppSessionId, patch as ReaderPatch, reader ?? 'owner'))));
  // W11 (I5): hidden projects included, marked `hidden`, so the renderer keeps their sessions out of Other sessions
  register('session.projects.list', () => ({ projects: index.projects.listWithRemoved(), revision: index.revision, rows: index.projects.list({ includeHidden: true }) })); // P5 O3-D: every row too (D13)
  // The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §G): every declaration, and
  // each act on a stored statement, through the index's statements (src/services/index/statements.ts), which leave
  // today's answer as it was while no stored statement is possible
  register('session.projects.add', async ({ directory }) => (await index.statements.declare(directory, (reads) => ({ project: index.projects.add(directory, reads) }))).project);
  // New chat: "Open folder…"; P5 O7 M9: another machine's owner's, claimed under `machine.op`, on the directory the
  // endpoint checked, checked again here before anything reads in it
  // (its linked-worktree answer read from git's files beforehand, so `setupLocate` asks no git: a miss would not fold)
  register('session.projects.addFolder', async ({ directory, opened, into, own }, context) => {
    const acts = { ...(into === undefined ? {} : { into }), ...(own === undefined ? {} : { own }) };
    if (context.op === undefined) return index.statements.addFolder(directory, acts);
    return await setupGuarded(directory, opened ?? [], setup, (checked, files) => index.statements.addFolder(checked, { ...acts, files, locateIn: setupLocate }));
  });
  register('session.projects.update', ({ id, patch }) => index.statements.update(id as ProjectId, patch));
  // M9's re-review, Fix 2: another machine's owner's remove derives (its `expect`) through their opens alone
  register('session.projects.remove', ({ id, expect, opened }, context) =>
    index.statements.remove(id as ProjectId, expect, context.op === undefined ? {} : { files: rowFiles(opened ?? [], setup) }),
  );
  // M9's review 1, F1: another machine's owner's resolve and relocate read the folder as its addFolder does, through the
  // checked reader (`remote`: the endpoint's call; `op`: its claimed act)
  register('session.projects.resolve', async ({ directory, opened }, context) => {
    if (context.remote !== true && context.op === undefined) return index.statements.resolve(directory);
    return await setupGuarded(directory, opened ?? [], setup, (checked, files) => index.statements.resolve(checked, { files, locateIn: setupLocate }));
  });
  // Fix 1c and the re-review's Fix 2: another machine's owner's link reads its row's folder (the target's own `.smns`, and
  // the derivation it answers) through that member's opens alone: a file it may not read names nothing, as one it guessed
  // wrong, and is no answer
  // panel 1, A2: `expect`, the path the asker confirmed, which the row must still have
  register('session.projects.link', ({ id, into, expect, opened }, context) =>
    index.statements.link(id as ProjectId, into, { ...(expect === undefined ? {} : { expect }), ...(context.op === undefined ? {} : { files: rowFiles(opened ?? [], setup) }) }),
  );
  register('session.projects.relocate', async ({ id, directory, opened }, context) => {
    if (context.op === undefined) return index.statements.relocate(id as ProjectId, directory);
    return await setupGuarded(directory, opened ?? [], setup, (checked, files) => index.statements.relocate(id as ProjectId, checked, { files }));
  });
  // P5 O8 M6a (M6a's branch review, F3): a request the endpoint dispatched (it names the reader) is answered the draft as it
  // fits one answer over the channel, naming the attachments it leaves out (@shared/sessions/draft-fit.ts). M6a's
  // re-review, K1: and a cleared draft as one with no document, so the device saving there next names the clear's stamp.
  register('session.drafts.get', ({ appSessionId }, { reader, remote }) => {
    if (remote !== true && reader === undefined) return index.drafts.get(appSessionId as AppSessionId);
    const kept = index.drafts.kept(appSessionId as AppSessionId, reader);
    return kept === null ? null : draftForLink(kept);
  });
  // M6a's re-review, K2: the attachments a save names as left on the machine by its device's read are kept
  register('session.drafts.set', ({ appSessionId, draft, replaces }, { reader }) => {
    const app = appSessionId as AppSessionId;
    index.drafts.set(app, draft === null ? null : restoreWithheld(draft, index.drafts.get(app, reader)), reader, replaces);
  });
}

// U9 (R9): exactly `{archived: false}`, by the patch's own keys (an `undefined` field counts as named).
const isUnarchive = (patch: unknown): boolean => typeof patch === 'object' && patch !== null && Object.keys(patch).length === 1 && (patch as { archived?: unknown }).archived === false;

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
