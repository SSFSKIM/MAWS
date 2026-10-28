// The scenario backend for the record side (C5 execution document, Repository map and Main modules): in-memory answers
// to C4's `session.list`, `session.get`, `session.update` and `session.projects.list`, with C4's unread rule, installed
// through `interceptCommand` in launch mode `scenario` only. Permanent: it is how dev and the smoke run without an
// index, not a stand-in to be replaced.
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord, SessionPatch } from '@shared/ipc/schema/session';

export type ChangeCause = 'discovered' | 'facts' | 'holder' | 'update' | 'live' | 'replay';
export type StubChange =
  | { kind: 'changed'; record: SessionRecord; cause: ChangeCause; revision: number }
  | { kind: 'removed'; appSessionId: AppSessionId; revision: number };

export class StubStore {
  private readonly records = new Map<AppSessionId, SessionRecord>();
  private readonly titles = new Map<AppSessionId, SessionRecord['title']>(); // the title before any override, for `title: null`
  private readonly visible = new Set<AppSessionId>();
  private readonly listeners = new Set<(change: StubChange) => void>();
  private revision = 0;

  constructor(
    private readonly projects: ProjectRecord[],
    records: SessionRecord[],
    private readonly now: () => string,
  ) {
    for (const r of records) this.load(r);
  }

  private load(r: SessionRecord): void {
    this.records.set(r.appId, r);
    this.titles.set(r.appId, r.title);
  }

  onChange(listener: (change: StubChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(record: SessionRecord, cause: ChangeCause): SessionRecord {
    this.records.set(record.appId, record);
    this.revision += 1;
    for (const listener of this.listeners) listener({ kind: 'changed', record, cause, revision: this.revision });
    return record;
  }

  private require(appSessionId: AppSessionId): SessionRecord {
    const record = this.records.get(appSessionId);
    if (!record) throw new Error(`unknown session ${appSessionId}`);
    return record;
  }

  list({ includeArchived = false }: { includeArchived?: boolean }): { sessions: SessionRecord[]; revision: number } {
    const sessions: SessionRecord[] = [];
    for (const r of this.records.values()) if (includeArchived || !r.archived) sessions.push(r);
    return { sessions, revision: this.revision };
  }

  get(appSessionId: AppSessionId): SessionRecord | null {
    return this.records.get(appSessionId) ?? null;
  }

  projectsList(): { projects: ProjectRecord[]; revision: number } {
    return { projects: this.projects, revision: this.revision };
  }

  update(appSessionId: AppSessionId, patch: SessionPatch): SessionRecord {
    const current = this.require(appSessionId);
    const next: SessionRecord = { ...current, updatedAt: this.now() };
    if (patch.pinned !== undefined) next.pinned = patch.pinned;
    if (patch.archived !== undefined) next.archived = patch.archived;
    if (patch.unread !== undefined) next.unread = patch.unread;
    if (patch.lastSeen !== undefined) next.lastSeen = patch.lastSeen;
    if (patch.title !== undefined) next.title = patch.title ?? this.titles.get(appSessionId) ?? current.title;
    return this.changed(next, 'update');
  }

  // C4's unread rule, from the visible set: becoming visible marks the session seen at once.
  setVisible(appSessionId: AppSessionId, visible: boolean): void {
    if (visible) this.visible.add(appSessionId);
    else this.visible.delete(appSessionId);
    const record = this.records.get(appSessionId);
    if (visible && record) this.markSeen(record);
  }

  // The scenario's turn end stands for the index's `lastRecordAt` advance: unread unless visible, and a visible
  // session is marked seen in the same step so it never flickers unread.
  turnEnded(appSessionId: AppSessionId): void {
    const record = this.require(appSessionId);
    if (this.visible.has(appSessionId)) this.markSeen(record);
    else if (!record.unread) this.changed({ ...record, unread: true }, 'live');
  }

  private markSeen(record: SessionRecord): void {
    this.changed({ ...record, unread: false, lastSeen: { messageUuid: record.lastSeen.messageUuid, at: this.now() } }, 'live');
  }

  put(record: SessionRecord, cause: ChangeCause): void {
    this.titles.set(record.appId, record.title);
    this.changed(record, cause);
  }

  remove(appSessionId: AppSessionId): void {
    if (!this.records.delete(appSessionId)) return;
    this.titles.delete(appSessionId);
    this.visible.delete(appSessionId);
    this.revision += 1;
    for (const listener of this.listeners) listener({ kind: 'removed', appSessionId, revision: this.revision });
  }
}
