import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { endableClientRef, type HandlerContext } from '@shared/ipc/client';
import type { CommandName } from '@shared/ipc/schema';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';
import { registerIndexHandlers } from './register';

// The handlers answer through the services bus (P5 O3-C M1), routed as main's router routes them.
describe('main answers the record side of session.* from the index', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let bus: FakeBus;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    bus = fakeBus();
    registerIndexHandlers(index, bus);
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });

  const invoke = (name: CommandName, input?: unknown, context?: HandlerContext) => bus.invoke(name, input, context) as Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }>;

  it('session.list and session.get answer records with the index revision; get answers null for an id with no row', async () => {
    const { record } = index.sessions.upsertFromSummary(summary());
    index.sessions.update(record.appId, { archived: true });
    const other = index.sessions.upsertFromSummary(summary()).record;
    expect(await invoke('session.list', {})).toEqual({ ok: true, value: { sessions: [index.sessions.get(other.appId)], revision: index.revision } });
    expect(((await invoke('session.list', { includeArchived: true })).value as { sessions: unknown[] }).sessions).toHaveLength(2);
    expect(await invoke('session.get', { appSessionId: other.appId })).toEqual({ ok: true, value: index.sessions.get(other.appId) });
    expect(await invoke('session.get', { appSessionId: randomUUID() })).toEqual({ ok: true, value: null });
  });

  it('session.update maps pin, mark-read, unread, archive and the title override', async () => {
    const { record } = index.sessions.upsertFromSummary(summary({ customTitle: 'Engine title' }));
    index.sessions.setUnread(record.appId, true);
    const pinned = await invoke('session.update', { appSessionId: record.appId, patch: { pinned: true } });
    expect(pinned).toMatchObject({ ok: true, value: { pinned: true, unread: true } });
    const read = await invoke('session.update', { appSessionId: record.appId, patch: { unread: false, lastSeen: { messageUuid: 'm9', at: '2026-09-28T12:00:00.000Z' } } });
    expect(read).toMatchObject({ ok: true, value: { unread: false, lastSeen: { messageUuid: 'm9' as MessageUuid, at: '2026-09-28T12:00:00.000Z' } } });
    expect(await invoke('session.update', { appSessionId: record.appId, patch: { unread: true } })).toMatchObject({ value: { unread: true, lastSeen: { messageUuid: 'm9' } } });
    expect(await invoke('session.update', { appSessionId: record.appId, patch: { unread: false } })).toMatchObject({ value: { unread: false, lastSeen: { messageUuid: 'm9' } } });
    const renamed = await invoke('session.update', { appSessionId: record.appId, patch: { title: { text: 'Mine', source: 'user' }, archived: true } });
    expect(renamed).toMatchObject({ ok: true, value: { title: { text: 'Mine', source: 'user' }, archived: true } });
    expect(await invoke('session.update', { appSessionId: record.appId, patch: { title: null } })).toMatchObject({ value: { title: { text: 'Engine title', source: 'user' } } });
    expect(await invoke('session.update', { appSessionId: record.appId, patch: {} })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('session.update and session.drafts.* for an app session with no row fail internal "unknown app session: <id>"', async () => {
    const unknown = randomUUID() as AppSessionId;
    const expected = { ok: false, error: { code: 'internal', message: `unknown app session: ${unknown}` } };
    expect(await invoke('session.update', { appSessionId: unknown, patch: { pinned: true } })).toEqual(expected);
    expect(await invoke('session.drafts.set', { appSessionId: unknown, draft: null })).toEqual(expected);
    expect(await invoke('session.drafts.get', { appSessionId: unknown })).toEqual(expected);
  });

  it('session.drafts.set and get round-trip a draft', async () => {
    const { record } = index.sessions.upsertFromSummary(summary());
    const draft = { doc: { type: 'doc' }, attachments: [], updatedAt: '2026-09-28T10:00:00.000Z' };
    expect(await invoke('session.drafts.set', { appSessionId: record.appId, draft })).toEqual({ ok: true, value: undefined });
    expect(await invoke('session.drafts.get', { appSessionId: record.appId })).toEqual({ ok: true, value: draft });
  });

  // P5 O8 M6a (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §P): `context.reader`, which only
  // mawsd's services front writes (for the endpoint's dispatch), routes the reads and drafts to the reader's own state;
  // 'owner' and no reader alike read the session row's, the machine owners' state.
  describe('by the context’s reader', () => {
    const B = 'b'.repeat(32);
    const as = (reader: string): HandlerContext => ({ client: endableClientRef('endpoint:1'), remote: true, reader });
    const at = '2026-09-28T12:00:00.000Z';

    it('session.get and session.list answer the reader’s pinned, lastSeen and unread', async () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      index.sessions.setPinned(record.appId, true);
      index.sessions.setUnread(record.appId, true);
      index.sessions.markSeen(record.appId, { messageUuid: 'm1' as MessageUuid, at }, B);
      const owners = index.sessions.get(record.appId)!;
      const theirs = { ...owners, pinned: false, unread: false, lastSeen: { messageUuid: 'm1', at } };
      expect(await invoke('session.get', { appSessionId: record.appId }, as(B))).toEqual({ ok: true, value: theirs });
      expect(await invoke('session.list', {}, as(B))).toEqual({ ok: true, value: { sessions: [theirs], revision: index.revision } });
      expect(await invoke('session.get', { appSessionId: record.appId }, as('owner'))).toEqual({ ok: true, value: owners });
      expect(await invoke('session.list', {}, as('owner'))).toEqual({ ok: true, value: { sessions: [owners], revision: index.revision } });
    });

    it('session.drafts.get and .set read and write the reader’s own draft', async () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      const owners = { doc: { type: 'doc' }, attachments: [], updatedAt: '2026-09-28T10:00:00.000Z' };
      const theirs = { doc: null, attachments: [], updatedAt: '2026-09-28T11:00:00.000Z' };
      await invoke('session.drafts.set', { appSessionId: record.appId, draft: owners });
      expect(await invoke('session.drafts.get', { appSessionId: record.appId }, as(B))).toEqual({ ok: true, value: null });
      expect(await invoke('session.drafts.set', { appSessionId: record.appId, draft: theirs }, as(B))).toEqual({ ok: true, value: undefined });
      expect(await invoke('session.drafts.get', { appSessionId: record.appId }, as(B))).toEqual({ ok: true, value: theirs });
      expect(await invoke('session.drafts.get', { appSessionId: record.appId }, as('owner'))).toEqual({ ok: true, value: owners });
      expect(await invoke('session.drafts.get', { appSessionId: record.appId })).toEqual({ ok: true, value: owners });
    });

    // `session.update`'s answer is the whole record (paths, settings, a spawn's signed act), which a reader must never be
    // answered; a reader's update is `session.reader.update` (Decision Log, "M6a Task 1's fork"). Refused before any write.
    it('session.update with a reader is refused, and writes nothing', async () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      for (const reader of [B, 'owner']) {
        expect(await invoke('session.update', { appSessionId: record.appId, patch: { pinned: true } }, as(reader))).toMatchObject({ ok: false, error: { code: 'internal' } });
      }
      expect(index.sessions.get(record.appId)!.pinned).toBe(false);
      expect(index.sessions.get(record.appId, B)!.pinned).toBe(false);
    });

    it('session.reader.update writes a member’s own state and answers their ReaderState alone: no record, no change, no revision', async () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      index.sessions.setUnread(record.appId, true);
      const changes: unknown[] = [];
      index.sessions.onChange((changed) => changes.push(changed));
      const revision = index.revision;
      const pinned = await invoke('session.reader.update', { appSessionId: record.appId, patch: { pinned: true } }, as(B));
      expect(pinned).toEqual({ ok: true, value: { appSessionId: record.appId, pinned: true, lastSeen: { messageUuid: null, at: null }, unread: false } });
      expect(await invoke('session.reader.update', { appSessionId: record.appId, patch: { unread: true } }, as(B))).toMatchObject({ value: { pinned: true, unread: true } });
      // "Mark all read": lastSeen with unread false, as session.update maps it
      expect(await invoke('session.reader.update', { appSessionId: record.appId, patch: { unread: false, lastSeen: { messageUuid: 'm9', at } } }, as(B))).toEqual({
        ok: true,
        value: { appSessionId: record.appId, pinned: true, lastSeen: { messageUuid: 'm9', at }, unread: false },
      });
      expect(changes).toEqual([]);
      expect(index.revision).toBe(revision);
      expect(index.sessions.get(record.appId)).toMatchObject({ pinned: false, unread: true, lastSeen: { messageUuid: null, at: null } });
    });

    it('session.reader.update with no reader, or the owner, writes the session row and answers the owners’ ReaderState', async () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      expect(await invoke('session.reader.update', { appSessionId: record.appId, patch: { pinned: true } })).toEqual({ ok: true, value: { appSessionId: record.appId, pinned: true, lastSeen: { messageUuid: null, at: null }, unread: false } });
      expect(await invoke('session.reader.update', { appSessionId: record.appId, patch: { unread: true } }, as('owner'))).toEqual({ ok: true, value: { appSessionId: record.appId, pinned: true, lastSeen: { messageUuid: null, at: null }, unread: true } });
      expect(index.sessions.get(record.appId)).toMatchObject({ pinned: true, unread: true });
      expect(index.sessions.get(record.appId, B)).toMatchObject({ pinned: false, unread: false });
    });

    // The architect's ruling 1 on session.reader.update (Decision Log, 2026-11-07): an owner's write lands on the owners'
    // row, the session row's columns, and never on a member row; a non-owner's lands on that member's own row alone, never
    // the owners' or another member's. Read from the tables themselves, so no read path can stand in for a write.
    it('session.reader.update writes exactly the caller’s row: the owners’ for an owner, the member’s own for a member', async () => {
      const C = 'c'.repeat(32);
      const { record } = index.sessions.upsertFromSummary(summary());
      const tables = () => {
        const raw = new DatabaseSync(join(dir.path, 'index.sqlite'), { readOnly: true });
        try {
          return {
            owners: raw.prepare('SELECT pinned, last_seen_uuid, last_seen_at, unread FROM sessions WHERE app_id = ?').get(record.appId),
            members: raw.prepare('SELECT member, pinned, last_seen_uuid, last_seen_at, unread FROM reader_state WHERE app_session_id = ? ORDER BY member').all(record.appId),
          };
        } finally {
          raw.close();
        }
      };
      const unset = { pinned: 0, last_seen_uuid: null, last_seen_at: null, unread: 0 };

      await invoke('session.reader.update', { appSessionId: record.appId, patch: { pinned: true } });
      await invoke('session.reader.update', { appSessionId: record.appId, patch: { lastSeen: { messageUuid: 'm1', at } } }, as('owner'));
      expect(tables()).toEqual({ owners: { pinned: 1, last_seen_uuid: 'm1', last_seen_at: at, unread: 0 }, members: [] });

      await invoke('session.reader.update', { appSessionId: record.appId, patch: { unread: true } }, as(B));
      expect(tables()).toEqual({ owners: { pinned: 1, last_seen_uuid: 'm1', last_seen_at: at, unread: 0 }, members: [{ member: B, ...unset, unread: 1 }] });

      await invoke('session.reader.update', { appSessionId: record.appId, patch: { pinned: true, lastSeen: { messageUuid: 'm2', at } } }, as(C));
      await invoke('session.reader.update', { appSessionId: record.appId, patch: { unread: true } }, as('owner'));
      expect(tables()).toEqual({
        owners: { pinned: 1, last_seen_uuid: 'm1', last_seen_at: at, unread: 1 },
        members: [
          { member: B, ...unset, unread: 1 },
          { member: C, pinned: 1, last_seen_uuid: 'm2', last_seen_at: at, unread: 0 },
        ],
      });
    });

    it('session.reader.update takes reader fields alone, and fails for an app session with no row', async () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      for (const patch of [{}, { title: { text: 'Mine', source: 'user' } }, { archived: true }, { pinned: true, archived: true }]) {
        expect(await invoke('session.reader.update', { appSessionId: record.appId, patch }, as(B))).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      }
      const unknown = randomUUID();
      expect(await invoke('session.reader.update', { appSessionId: unknown, patch: { pinned: true } }, as(B))).toEqual({ ok: false, error: { code: 'internal', message: `unknown app session: ${unknown}` } });
      expect(index.sessions.get(record.appId)).toMatchObject({ title: { text: 'hello' }, archived: false });
    });
  });

  it('session.projects.* list, add, update and remove through the index', async () => {
    const tree = tempDir('maws-register-');
    try {
      const directory = join(tree.path, 'alpha');
      mkdirSync(directory);
      const added = await invoke('session.projects.add', { directory });
      expect(added).toMatchObject({ ok: true, value: { name: 'alpha', directory, order: 0 } });
      const id = (added.value as { id: string }).id;
      expect(await invoke('session.projects.list', undefined)).toEqual({ ok: true, value: { projects: [added.value], revision: index.revision, rows: [added.value] } }); // P5 O3-D M1: every row too (D13)
      expect(await invoke('session.projects.update', { id, patch: { name: 'Alpha' } })).toMatchObject({ ok: true, value: { id, name: 'Alpha' } });
      expect(await invoke('session.projects.remove', { id })).toEqual({ ok: true, value: undefined });
      // W11 (I5): the removed project stays on the list, marked, and an add shows it again
      expect(await invoke('session.projects.list', undefined)).toMatchObject({ value: { projects: [{ id, name: 'Alpha', hidden: true }], rows: [{ id, name: 'Alpha', hidden: true }] } });
      expect(await invoke('session.projects.add', { directory })).toMatchObject({ ok: true, value: { id } });
      expect(((await invoke('session.projects.list', undefined)).value as { projects: { hidden?: boolean }[] }).projects[0].hidden).toBeUndefined();
      expect(await invoke('session.projects.add', { directory: join(tree.path, 'missing') })).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringContaining('not a directory') } });
    } finally {
      tree.dispose();
    }
  });

  it('an index of a newer version answers every session.* command internal "index unavailable: <reason>"', async () => {
    index.close();
    const raw = new DatabaseSync(join(dir.path, 'index.sqlite'));
    raw.exec('PRAGMA user_version = 99');
    raw.close();
    index = new Index(join(dir.path, 'index.sqlite'));
    bus = fakeBus();
    registerIndexHandlers(index, bus);
    expect(index.readOnly).toBe(true);
    const unavailable = { ok: false, error: { code: 'internal', message: 'index unavailable: user_version 99 is newer than this app knows (15)' } }; // P2-C2: 9; P3-L: 10; P5 O6 M5: 13; P5 O3-A: 14; search resume: 15
    const appSessionId = randomUUID();
    expect(await invoke('session.list', {})).toEqual(unavailable);
    expect(await invoke('session.get', { appSessionId })).toEqual(unavailable);
    expect(await invoke('session.update', { appSessionId, patch: { pinned: true } })).toEqual(unavailable);
    expect(await invoke('session.projects.list', undefined)).toEqual(unavailable);
    expect(await invoke('session.drafts.get', { appSessionId })).toEqual(unavailable);
  });
});
