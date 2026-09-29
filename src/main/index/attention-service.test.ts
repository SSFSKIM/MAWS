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

  const start = (target: Index = index) => {
    const service = startIndexAttention(target, {
      onEvent: ((name: EventName, listener: (payload: unknown) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), listener]);
        return () => listeners.set(name, (listeners.get(name) ?? []).filter((l) => l !== listener));
      }) as AttentionServiceDeps['onEvent'],
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
    expect(changed.at(-1)).toEqual({ appSessionId: appId, items: [] });
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
    expect(changed.at(-1)).toEqual({ appSessionId: appId, items: [] });
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
