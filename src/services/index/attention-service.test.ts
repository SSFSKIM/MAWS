import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionItemSchema, type AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { summary, tempDir } from '../../../test/support/index-fixture';
import type { AttentionServiceDeps } from '../attention/service';
import { startIndexAttention } from './attention-service';
import { Index } from './index';
import { IndexSessionSource, type SourceHost } from './source';

const AT = '2026-09-28T10:00:00.000Z';
const errorItem = (appSessionId: AppSessionId): AttentionItem =>
  AttentionItemSchema.parse({
    id: `${appSessionId}:permission:req-1`, appSessionId, sessionId: null, kind: 'permission', summary: 'Allow?', createdAt: AT, stateChangedAt: AT, expiresAt: null,
    state: 'pending', request: { requestId: 'req-1', toolUseId: null, taskId: null, agentId: null },
  });

// C3's attention service, started over the index (C4's block in src/main/index.ts): its store is `Index.attention`, and
// an archive the index records (C3's ask: "attention retires on the archive path") retires the session as the engine
// host's `session.forgotten` does.
describe('attention persists through the index and retires on the archive path', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let listeners: Map<string, ((payload: unknown) => void)[]>;
  let changed: EventPayload<'attention.changed'>[];
  let stops: (() => void)[];

  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    listeners = new Map();
    changed = [];
    stops = [];
  });
  afterEach(() => {
    stops.forEach((stop) => stop());
    index.close();
    dir.dispose();
  });

  const start = (target: Index = index, seenNow?: (appSessionId: AppSessionId) => boolean) => {
    const service = startIndexAttention(target, {
      ...(seenNow && { seenNow }),
      onEvent: ((name: EventName, listener: (payload: unknown) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), listener]);
        return () => listeners.set(name, (listeners.get(name) ?? []).filter((l) => l !== listener));
      }) as AttentionServiceDeps['onEvent'],
      onState: () => () => {},
      dispatch: vi.fn(async () => ({ ok: true as const, value: { event: null } })),
      emit: (name, payload) => void (name === 'attention.changed' && changed.push(payload as EventPayload<'attention.changed'>)),
      register: () => {},
      fallbackFile: join(dir.path, 'attention.json'),
    });
    stops.push(() => service.stop());
    return service;
  };
  const fire = (name: EventName, payload: unknown) => (listeners.get(name) ?? []).forEach((listener) => listener(payload));
  const pending = async (appSessionId: AppSessionId) => {
    fire('session.brokerItems', { appSessionId, items: [errorItem(appSessionId)] });
  };

  it('keeps the items in the index; session.update { archived: true } retires them in the service, the renderer and the store', async () => {
    const appId = index.sessions.upsertFromSummary(summary()).record.appId;
    const service = start();
    await service.ready;
    await pending(appId);
    await service.settled();
    expect((await index.attention.list()).map((item) => item.id)).toEqual([`${appId}:permission:req-1`]);

    index.sessions.update(appId, { archived: true });
    await service.settled();
    expect(service.list()).toEqual([]);
    expect(changed.at(-1)).toEqual({ appSessionId: appId, items: [], silent: [] });
    expect(await index.attention.list()).toEqual([]);
    expect(existsSync(join(dir.path, 'attention.json'))).toBe(false); // the index is the store, not C3's file
  });

  it('a transcript removed from disk (the removal archive) retires them too; an unarchive and a later archive retire again', async () => {
    const s = summary();
    const appId = index.sessions.upsertFromSummary(s).record.appId;
    const service = start();
    await service.ready;
    await pending(appId);
    await service.settled();
    index.sessions.markTranscriptRemoved(s.sessionId);
    await service.settled();
    expect(changed.at(-1)).toEqual({ appSessionId: appId, items: [], silent: [] });
    expect(await index.attention.list()).toEqual([]);

    const retirements = () => changed.filter((c) => c.appSessionId === appId && c.items.length === 0).length;
    const before = retirements();
    index.sessions.upsertFromSummary(s); // back: the removal archive lifts
    index.sessions.setPinned(appId, true); // an unrelated change to an unarchived record retires nothing
    expect(retirements()).toBe(before);
    index.sessions.update(appId, { archived: true });
    expect(retirements()).toBe(before + 1);
  });

  it('a record archived before the service started is not retired again at start', async () => {
    const appId = index.sessions.upsertFromSummary(summary()).record.appId;
    index.sessions.update(appId, { archived: true });
    const service = start();
    await service.ready;
    index.sessions.setPinned(appId, true);
    expect(changed).toEqual([]);
  });

  // The owner's ruling (2026-10-30): "seen" is the index's unread rule, the record's last-seen mark and the shown set.
  describe('an error is raised only when newer than the session\'s last-seen mark', () => {
    const FAILED_AT = '2026-10-01T09:00:00.000Z';
    let n = 0;
    const failure = (appSessionId: AppSessionId, at = FAILED_AT) => {
      n += 1;
      fire('session.eventBatch', { appSessionId, events: [{ id: `${appSessionId}:disk:${n}`, sessionId: 'sid', at, seq: null, agentId: null, parentToolUseId: null, kind: 'turn.ended', isError: true, terminalReason: null, result: 'error_during_execution', resultText: null, isEchoReceipt: false, origin: null, errors: [], userMessageUuids: [] }] });
    };
    const errors = (service: ReturnType<typeof start>, appSessionId: AppSessionId) => service.list().filter((item) => item.appSessionId === appSessionId).map((item) => item.state);

    it('a session never seen tells once; marking it seen retires the error for good, in the service and the store', async () => {
      const appId = index.sessions.upsertFromSummary(summary()).record.appId;
      const service = start();
      await service.ready;
      failure(appId);
      expect(errors(service, appId)).toEqual(['pending']);
      index.sessions.markSeen(appId, { messageUuid: null, at: '2026-10-29T12:00:00.000Z' });
      expect(errors(service, appId)).toEqual(['retired']);
      await service.settled();
      expect((await index.attention.list()).map((item) => item.state)).toEqual(['retired']);
    });

    it('an error older than the session\'s last-seen mark raises nothing; one newer than it does', async () => {
      const appId = index.sessions.upsertFromSummary(summary()).record.appId;
      index.sessions.markSeen(appId, { messageUuid: null, at: '2026-10-29T12:00:00.000Z' });
      const service = start();
      await service.ready;
      failure(appId);
      expect(errors(service, appId)).toEqual([]);
      failure(appId, '2026-10-30T08:00:00.000Z');
      expect(errors(service, appId)).toEqual(['pending']);
    });

    it('a session a client shows sees its error as it arrives', async () => {
      const appId = index.sessions.upsertFromSummary(summary()).record.appId;
      let showing = true;
      const service = start(index, () => showing);
      await service.ready;
      failure(appId, '2026-10-30T08:00:00.000Z');
      expect(errors(service, appId)).toEqual([]);
      showing = false;
      failure(appId, '2026-10-30T08:00:01.000Z');
      expect(errors(service, appId)).toEqual(['pending']);
    });

    // Seen as it arrived is durable: the look is the record's last-seen mark, so the reader leaving before the transcript
    // advances, then a replay while no client shows the session (a restored tab hydrating, a restart), raises nothing.
    it('an error seen as it arrived stays seen once the reader leaves: a replay, and a restart\'s, raise nothing', async () => {
      const appId = index.sessions.upsertFromSummary(summary()).record.appId;
      let clock = '2026-10-30T07:59:00.000Z';
      const source = new IndexSessionSource(index, {} as SourceHost, { emit: () => true, now: () => clock });
      source.onSetVisible(appId, true);
      const service = start(index, (id) => source.seenNow(id));
      await service.ready;
      clock = '2026-10-30T08:00:00.500Z';
      failure(appId, '2026-10-30T08:00:00.000Z');
      expect(errors(service, appId)).toEqual([]);
      expect(index.sessions.get(appId)?.lastSeen.at).toBe(clock);
      source.onSetVisible(appId, false);
      failure(appId, '2026-10-30T08:00:00.000Z');
      expect(errors(service, appId)).toEqual([]);
      service.stop();
      const restarted = start(index, (id) => source.seenNow(id));
      await restarted.ready;
      failure(appId, '2026-10-30T08:00:00.000Z');
      expect(errors(restarted, appId)).toEqual([]);
      failure(appId, '2026-10-30T08:00:01.000Z');
      expect(errors(restarted, appId)).toEqual(['pending']);
    });

    // The mark `seenNow` writes reaches the service's `seen` while it is still deriving the batch: an open error that mark
    // covers (one the look at showing did not, its stamp ahead of the clock then) retires there, and the batch goes on.
    it('the mark written mid-batch retires the open errors it covers, in the service and the store', async () => {
      const appId = index.sessions.upsertFromSummary(summary()).record.appId;
      let clock = '2026-10-30T07:59:00.000Z';
      const source = new IndexSessionSource(index, {} as SourceHost, { emit: () => true, now: () => clock });
      const service = start(index, (id) => source.seenNow(id));
      await service.ready;
      failure(appId, '2026-10-30T08:00:00.000Z');
      source.onSetVisible(appId, true);
      expect(errors(service, appId)).toEqual(['pending']);
      clock = '2026-10-30T08:00:02.000Z';
      failure(appId, '2026-10-30T08:00:01.000Z');
      expect(errors(service, appId)).toEqual(['retired']);
      await service.settled();
      expect((await index.attention.list()).map((item) => item.state)).toEqual(['retired']);
    });
  });

  it('an index this app cannot read falls back to C3\'s file store', async () => {
    const path = join(dir.path, 'newer.sqlite');
    const raw = new DatabaseSync(path);
    raw.exec('CREATE TABLE sessions (id INTEGER PRIMARY KEY); PRAGMA user_version = 99');
    raw.close();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const newer = new Index(path);
    expect(newer.unavailable).not.toBeNull();
    try {
      const service = start(newer);
      await service.ready;
      await pending('app-file' as AppSessionId);
      await service.settled();
      expect(JSON.parse(readFileSync(join(dir.path, 'attention.json'), 'utf8')).sessions['app-file']).toHaveLength(1);
    } finally {
      newer.close();
      error.mockRestore();
    }
  });
});
