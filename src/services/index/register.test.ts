import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { endableClientRef, type HandlerContext } from '@shared/ipc/client';
import type { CommandName } from '@shared/ipc/schema';
import { STALE_DRAFT_WORDS, type Draft } from '@shared/ipc/schema/session';
import { REMOTE_INLINE_MAX_BYTES } from '@shared/ipc/schema/remote';
import { WITHHELD_ATTACHMENTS } from '@shared/sessions/draft-fit';
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

    // M6a's branch review, F1: a remote device's draft save names the draft it replaces (its `updatedAt`, null for none),
    // and one whose replaced draft is no longer the kept one is refused: an act main answered `timeout` that lands after a
    // newer save can't put its older text back. A save naming none (this Mac's own composer) writes as it always has.
    it('session.drafts.set refuses a save whose replaced draft is no longer the kept one, for every reader', async () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      const draftAt = (text: string, updatedAt: string) => ({ doc: { type: 'doc', text }, attachments: [], updatedAt });
      const [older, newer] = [draftAt('older', '2026-09-28T10:00:00.000Z'), draftAt('newer', '2026-09-28T10:00:01.000Z')];
      for (const context of [as(B), as('owner')]) {
        const set = (draft: unknown, replaces: string | null) => invoke('session.drafts.set', { appSessionId: record.appId, draft, replaces }, context);
        expect(await set(newer, null)).toEqual({ ok: true, value: undefined }); // the newer save went first
        expect(await set(older, null)).toEqual({ ok: false, error: { code: 'internal', message: STALE_DRAFT_WORDS } }); // the older, late
        expect(await invoke('session.drafts.get', { appSessionId: record.appId }, context)).toEqual({ ok: true, value: newer });
        expect(await set(null, older.updatedAt)).toMatchObject({ ok: false, error: { message: STALE_DRAFT_WORDS } });
        expect(await set(null, newer.updatedAt)).toEqual({ ok: true, value: undefined }); // cleared, on top of the kept one
        // M6a's re-review, K1: read over the link, the clear is a draft with no document, carrying the stamp it was kept at
        const cleared = await invoke('session.drafts.get', { appSessionId: record.appId }, context);
        expect(cleared).toEqual({ ok: true, value: { doc: null, attachments: [], updatedAt: expect.any(String) } });
        expect(await set(newer, null)).toMatchObject({ ok: false, error: { message: STALE_DRAFT_WORDS } });
        expect(await set(newer, (cleared.value as { updatedAt: string }).updatedAt)).toEqual({ ok: true, value: undefined });
        expect(await set(null, newer.updatedAt)).toEqual({ ok: true, value: undefined });
      }
      expect(await invoke('session.drafts.get', { appSessionId: record.appId })).toEqual({ ok: true, value: null }); // this Mac's own read: none
      expect(await invoke('session.drafts.set', { appSessionId: record.appId, draft: older })).toEqual({ ok: true, value: undefined });
      expect(await invoke('session.drafts.set', { appSessionId: record.appId, draft: newer })).toEqual({ ok: true, value: undefined });
    });

    // M6a's branch review, F3: a draft whose attachments are past what one answer over a machine link carries (the
    // owners' saved by the machine's own app, up to the composer's 4 MiB of attachments, base64 in the document) is read
    // remotely as its text and the attachments that fit, the rest named as left out; this machine's own read is whole.
    it('session.drafts.get answers a remote reader a draft past the link’s bound without the attachments that don’t fit', async () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      const pdf = { id: 'a1', kind: 'document', name: 'paper.pdf', mediaType: 'application/pdf', bytes: 3 * 1024 * 1024, data: 'A'.repeat(4 * 1024 * 1024), persisted: true };
      const note = { id: 'a2', kind: 'file', name: 'note.txt', mediaType: 'text/plain', bytes: 2, data: 'aGk=', persisted: true };
      const whole = { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'read these' }] }], attrs: { attachments: [pdf, note] } }, attachments: [], updatedAt: at };
      index.drafts.set(record.appId, whole);
      expect(await invoke('session.drafts.get', { appSessionId: record.appId })).toEqual({ ok: true, value: whole });
      const remote = await invoke('session.drafts.get', { appSessionId: record.appId }, as('owner'));
      expect(remote).toEqual({ ok: true, value: { ...whole, doc: { ...whole.doc, attrs: { attachments: [note], [WITHHELD_ATTACHMENTS]: [{ id: 'a1', name: 'paper.pdf' }] } } } });
      expect(new TextEncoder().encode(JSON.stringify(remote.value)).length).toBeLessThanOrEqual(REMOTE_INLINE_MAX_BYTES);
    });

    // M6a's re-review, K2 (the reviewer's round trip): an attachment a link's read left on the machine is no removal. The
    // device's save names those its read left there (WITHHELD_ATTACHMENTS, as remote-drafts.ts writes it), and the machine
    // keeps them; one the device held and saves without is removed, as before.
    it('session.drafts.set keeps on the machine the attachments the saving device’s read left there', async () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      const pdf = { id: 'a1', kind: 'document', name: 'paper.pdf', mediaType: 'application/pdf', bytes: 3 * 1024 * 1024, data: 'A'.repeat(4 * 1024 * 1024), persisted: true };
      const note = { id: 'a2', kind: 'file', name: 'note.txt', mediaType: 'text/plain', bytes: 2, data: 'aGk=', persisted: true };
      for (const context of [as('owner'), as(B)]) {
        index.drafts.set(record.appId, { doc: { type: 'doc', text: 'read this', attrs: { attachments: [pdf, note] } }, attachments: [], updatedAt: '2026-11-07T10:00:00.000Z' }, context.reader);
        const projected = (await invoke('session.drafts.get', { appSessionId: record.appId }, context)).value as Draft & { doc: { attrs: Record<string, unknown> } };
        const edited = { ...projected, doc: { ...projected.doc, text: 'read this please' }, updatedAt: '2026-11-07T10:01:00.000Z' };
        expect(await invoke('session.drafts.set', { appSessionId: record.appId, draft: edited, replaces: projected.updatedAt }, context)).toEqual({ ok: true, value: undefined });
        expect(index.drafts.get(record.appId, context.reader)!.doc).toEqual({ type: 'doc', text: 'read this please', attrs: { attachments: [note, pdf] } });
        const without = { ...edited, doc: { ...edited.doc, attrs: { ...edited.doc.attrs, attachments: [] } }, updatedAt: '2026-11-07T10:02:00.000Z' }; // the note taken off
        expect(await invoke('session.drafts.set', { appSessionId: record.appId, draft: without, replaces: edited.updatedAt }, context)).toEqual({ ok: true, value: undefined });
        expect(index.drafts.get(record.appId, context.reader)!.doc).toEqual({ type: 'doc', text: 'read this please', attrs: { attachments: [pdf] } });
      }
    });

    // `session.update`'s answer is the whole record (paths, settings, a spawn's signed act), which a reader must never be
    // answered as the owners read it; a reader's update is `session.reader.update` (Decision Log, "M6a Task 1's fork").
    // Refused before any write, but for the unarchive (the UX wave's U9, R9, below).
    it('session.update with a reader is refused, and writes nothing, for every patch but exactly an unarchive', async () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      index.sessions.update(record.appId, { archived: true });
      const patches = [{ pinned: true }, { archived: true }, { archived: false, pinned: true }, { archived: false, unread: false }, { title: { text: 'Mine', source: 'user' } }];
      for (const reader of [B, 'owner']) {
        for (const patch of patches) expect(await invoke('session.update', { appSessionId: record.appId, patch }, as(reader)), `${reader} ${JSON.stringify(patch)}`).toMatchObject({ ok: false, error: { code: 'internal' } });
      }
      expect(index.sessions.get(record.appId)!.pinned).toBe(false);
      expect(index.sessions.get(record.appId)!.archived).toBe(true);
      expect(index.sessions.get(record.appId, B)!.pinned).toBe(false);
    });

    // The UX wave (U9, R9, as the session that keeps master ruled it): an unarchive is the one `session.update` a reader may
    // make, its patch checked here whatever the endpoint admitted, and it answers the record as `session.get` answers that
    // reader, read after the write: never the owners' reading for a member.
    it('session.update with a reader takes exactly `{archived: false}` and answers the record as that reader reads it', async () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      index.sessions.setPinned(record.appId, true);
      index.sessions.markSeen(record.appId, { messageUuid: 'm1' as MessageUuid, at });
      for (const reader of [B, 'owner']) {
        index.sessions.update(record.appId, { archived: true });
        const answer = await invoke('session.update', { appSessionId: record.appId, patch: { archived: false } }, as(reader));
        expect(answer, reader).toEqual({ ok: true, value: index.sessions.get(record.appId, reader) });
        expect((answer.value as { archived: boolean }).archived).toBe(false);
      }
      const theirs = (await invoke('session.update', { appSessionId: record.appId, patch: { archived: false } }, as(B))).value as Record<string, unknown>;
      expect({ pinned: theirs.pinned, lastSeen: theirs.lastSeen }).toEqual({ pinned: false, lastSeen: { messageUuid: null, at: null } });
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
