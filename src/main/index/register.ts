// Main's handlers for the record side of `session.*` (C4 execution document, M4): `session.list`, `session.get`,
// `session.update`, `session.projects.*` and `session.drafts.*`, answered from the index. A handler that throws becomes
// `internal` with the thrown message at the router (an unknown app session id, a read-only index, a bad directory).
import type { AppSessionId, MessageUuid, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { SessionPatch } from '@shared/ipc/schema/session';
import { registerMainHandler } from '../ipc/router';
import type { Index } from './index';

export function registerIndexHandlers(index: Index): void {
  registerMainHandler('session.list', ({ includeArchived }) => ({ sessions: index.sessions.list({ includeArchived }), revision: index.revision }));
  // An app session id with no row (an unstarted tab) is an answer, not an error.
  registerMainHandler('session.get', ({ appSessionId }) => index.sessions.get(appSessionId as AppSessionId));
  registerMainHandler('session.update', ({ appSessionId, patch }) => applyPatch(index, appSessionId as AppSessionId, patch as SessionPatch));
  registerMainHandler('session.projects.list', () => ({ projects: index.projects.list(), revision: index.revision }));
  registerMainHandler('session.projects.add', ({ directory }) => index.projects.add(directory));
  registerMainHandler('session.projects.update', ({ id, patch }) => index.projects.update(id as ProjectId, patch));
  registerMainHandler('session.projects.remove', ({ id }) => index.projects.hide(id as ProjectId));
  registerMainHandler('session.drafts.get', ({ appSessionId }) => index.drafts.get(appSessionId as AppSessionId));
  registerMainHandler('session.drafts.set', ({ appSessionId, draft }) => index.drafts.set(appSessionId as AppSessionId, draft));
}

// `pinned` → setPinned; `lastSeen` (with or without `unread: false`, "Mark all read") → markSeen, which clears unread;
// `unread` alone → setUnread; `title` (the override of the Title rule) and `archived` → update. One transaction.
function applyPatch(index: Index, appId: AppSessionId, patch: SessionPatch): SessionRecord {
  return index.transaction(() => {
    let record = index.sessions.get(appId);
    if (record === null) throw new Error(`unknown app session: ${appId}`);
    if (patch.pinned !== undefined) record = index.sessions.setPinned(appId, patch.pinned);
    if (patch.lastSeen !== undefined) record = index.sessions.markSeen(appId, { messageUuid: patch.lastSeen.messageUuid as MessageUuid | null, at: patch.lastSeen.at });
    if (patch.unread !== undefined && !(patch.lastSeen !== undefined && !patch.unread)) record = index.sessions.setUnread(appId, patch.unread);
    if (patch.title !== undefined || patch.archived !== undefined) record = index.sessions.update(appId, { title: patch.title, archived: patch.archived });
    return record;
  });
}
