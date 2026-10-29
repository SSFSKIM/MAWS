import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
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

  const invoke = (name: CommandName, input?: unknown) => bus.invoke(name, input) as Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }>;

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

  it('session.projects.* list, add, update and remove through the index', async () => {
    const tree = tempDir('maws-register-');
    try {
      const directory = join(tree.path, 'alpha');
      mkdirSync(directory);
      const added = await invoke('session.projects.add', { directory });
      expect(added).toMatchObject({ ok: true, value: { name: 'alpha', directory, order: 0 } });
      const id = (added.value as { id: string }).id;
      expect(await invoke('session.projects.list', undefined)).toEqual({ ok: true, value: { projects: [added.value], revision: index.revision } });
      expect(await invoke('session.projects.update', { id, patch: { name: 'Alpha' } })).toMatchObject({ ok: true, value: { id, name: 'Alpha' } });
      expect(await invoke('session.projects.remove', { id })).toEqual({ ok: true, value: undefined });
      // W11 (I5): the removed project stays on the list, marked, and an add shows it again
      expect(await invoke('session.projects.list', undefined)).toMatchObject({ value: { projects: [{ id, name: 'Alpha', hidden: true }] } });
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
    const unavailable = { ok: false, error: { code: 'internal', message: 'index unavailable: user_version 99 is newer than this app knows (14)' } }; // P2-C2: 9; P3-L: 10; P5 O6 M5: 13; P5 O3-A: 14
    const appSessionId = randomUUID();
    expect(await invoke('session.list', {})).toEqual(unavailable);
    expect(await invoke('session.get', { appSessionId })).toEqual(unavailable);
    expect(await invoke('session.update', { appSessionId, patch: { pinned: true } })).toEqual(unavailable);
    expect(await invoke('session.projects.list', undefined)).toEqual(unavailable);
    expect(await invoke('session.drafts.get', { appSessionId })).toEqual(unavailable);
  });
});
