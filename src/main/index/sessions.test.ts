import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, MessageUuid, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { SessionRecordSchema } from '@shared/graph/session';
import { sessionIdFor, summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';

const LAUNCH = {
  directory: '/nowhere/launch',
  additionalDirectories: ['/nowhere/extra'],
  worktree: null,
  model: { requested: 'opus', resolved: null },
  effort: 'high',
  permissionMode: { requested: 'auto', effective: 'auto', refusal: null },
} as const satisfies Omit<Parameters<Index['sessions']['createForLaunch']>[0], 'appSessionId'>;

describe('session records in the index', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let changes: [SessionRecord, string][];
  let bindings: [AppSessionId, SessionId | null][];
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    changes = [];
    bindings = [];
    index.sessions.onChange((record, cause) => changes.push([record, cause]));
    index.sessions.onBinding((appId, sessionId) => bindings.push([appId, sessionId]));
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });

  const titleOf = (appId: AppSessionId) => index.sessions.get(appId)!.title;

  it('upsertFromSummary twice with the same summary creates one row and answers created: false the second time', () => {
    const s = summary();
    const first = index.sessions.upsertFromSummary(s);
    expect(first.created).toBe(true);
    expect(SessionRecordSchema.parse(first.record)).toEqual(first.record);
    expect(first.record).toMatchObject({
      engineSessionId: s.sessionId,
      projectId: null,
      directory: '/nowhere/at/all',
      title: { text: 'hello', source: 'none' },
      holder: { kind: 'none' },
      gateway: { routed: true, baseUrl: null, autoModeServer: 'unknown' },
      pinned: false,
      archived: false,
      unread: false,
    });
    const second = index.sessions.upsertFromSummary(s);
    expect(second.created).toBe(false);
    expect(second.record.appId).toBe(first.record.appId);
    expect(index.sessions.list()).toHaveLength(1);
    expect(changes.map(([, cause]) => cause)).toEqual(['discovered']); // an unchanged summary is silent
    expect(bindings).toEqual([[first.record.appId, s.sessionId]]);
    expect(index.sessions.summaries().get(first.record.appId)).toEqual(s);
  });

  it('reports an advance only when lastRecordAt moves past a stored value', () => {
    const s = summary();
    expect(index.sessions.upsertFromSummary(s).advanced).toBe(false); // first sight is not news
    expect(index.sessions.upsertFromSummary({ ...s, size: 200 }).advanced).toBe(false);
    expect(index.sessions.upsertFromSummary({ ...s, lastRecordAt: '2026-09-28T11:00:00.000Z' }).advanced).toBe(true);
  });

  describe('title gates (the Title rule)', () => {
    it('two consecutive terminal renames: the second reaches the record as user', () => {
      const s = summary({ customTitle: 'A' });
      const { record } = index.sessions.upsertFromSummary(s);
      expect(titleOf(record.appId)).toEqual({ text: 'A', source: 'user' });
      index.sessions.upsertFromSummary({ ...s, customTitle: 'B' });
      expect(titleOf(record.appId)).toEqual({ text: 'B', source: 'user' });
    });

    it('a regenerated AI title replaces the previous one, and never displaces a custom title', () => {
      const s = summary({ aiTitle: 'X' });
      const { record } = index.sessions.upsertFromSummary(s);
      expect(titleOf(record.appId)).toEqual({ text: 'X', source: 'generated' });
      index.sessions.upsertFromSummary({ ...s, aiTitle: 'Y' });
      expect(titleOf(record.appId)).toEqual({ text: 'Y', source: 'generated' });
      index.sessions.upsertFromSummary({ ...s, aiTitle: 'Y', customTitle: 'Mine' });
      index.sessions.upsertFromSummary({ ...s, aiTitle: 'Z', customTitle: 'Mine' });
      expect(titleOf(record.appId)).toEqual({ text: 'Mine', source: 'user' });
    });

    it('a MAWS rename holds through unchanged custom titles and any AI title, yields to a new terminal rename, and clears to the engine title', () => {
      const s = summary({ customTitle: null, aiTitle: 'X' });
      const { record } = index.sessions.upsertFromSummary(s);
      index.sessions.update(record.appId, { title: { text: 'M', source: 'user' } });
      expect(titleOf(record.appId)).toEqual({ text: 'M', source: 'user' });
      index.sessions.upsertFromSummary({ ...s, aiTitle: 'Y' });
      index.sessions.upsertFromSummary({ ...s, aiTitle: 'Z', size: 300 });
      expect(titleOf(record.appId)).toEqual({ text: 'M', source: 'user' });
      index.sessions.upsertFromSummary({ ...s, customTitle: 'T' });
      expect(titleOf(record.appId)).toEqual({ text: 'T', source: 'user' });

      // An override set while a custom title stands holds while that custom title is unchanged.
      index.sessions.update(record.appId, { title: { text: 'M2', source: 'tool' } });
      index.sessions.upsertFromSummary({ ...s, customTitle: 'T', aiTitle: 'W' });
      expect(titleOf(record.appId)).toEqual({ text: 'M2', source: 'tool' });
      index.sessions.update(record.appId, { title: null });
      expect(titleOf(record.appId)).toEqual({ text: 'T', source: 'user' });
    });

    it('falls back from custom to AI title to first prompt to an empty title', () => {
      const { record } = index.sessions.upsertFromSummary(summary({ firstPrompt: null }));
      expect(titleOf(record.appId)).toEqual({ text: '', source: 'none' });
    });
  });

  it('setHolder moves a foreign holder, answers null for an unknown engine id, and leaves a self-held record alone', () => {
    const s = summary();
    const { record } = index.sessions.upsertFromSummary(s);
    expect(index.sessions.setHolder(s.sessionId, { kind: 'terminal', pid: 42 })?.holder).toEqual({ kind: 'terminal', pid: 42 });
    expect(index.sessions.setHolder(sessionIdFor(999), { kind: 'terminal', pid: 1 })).toBeNull();
    index.sessions.applyEngineStatus(record.appId, { holder: { kind: 'self' } });
    changes.length = 0;
    expect(index.sessions.setHolder(s.sessionId, { kind: 'none' })?.holder).toEqual({ kind: 'self' });
    expect(changes).toEqual([]);
  });

  it('upserts 4,000 synthetic summaries inside one transaction in under 500 ms', () => {
    const summaries = Array.from({ length: 4_000 }, (_, i) => summary({ sessionId: sessionIdFor(i + 1), customTitle: i % 3 === 0 ? `t${i}` : null }));
    const started = performance.now();
    index.transaction(() => {
      for (const s of summaries) index.sessions.upsertFromSummary(s);
    });
    const elapsed = performance.now() - started;
    expect(index.sessions.list()).toHaveLength(4_000);
    expect(elapsed).toBeLessThan(500);
  });

  it('createForLaunch takes a caller-supplied UUID v4 and answers exists with the first record on a collision', () => {
    const appSessionId = randomUUID() as AppSessionId;
    const created = index.sessions.createForLaunch({ appSessionId, ...LAUNCH });
    expect(created).toMatchObject({ ok: true, record: { appId: appSessionId, engineSessionId: null, directory: '/nowhere/launch', additionalDirectories: ['/nowhere/extra'], effort: 'high' } });
    const again = index.sessions.createForLaunch({ appSessionId, ...LAUNCH, directory: '/elsewhere' });
    expect(again).toEqual({ ok: false, reason: 'exists', record: index.sessions.get(appSessionId) });
    expect(index.sessions.get(appSessionId)?.directory).toBe('/nowhere/launch');
    expect(() => index.sessions.createForLaunch({ appSessionId: 'not-a-uuid' as AppSessionId, ...LAUNCH })).toThrow('not a UUID v4: not-a-uuid');

    const allocated = index.sessions.createForLaunch(LAUNCH);
    expect(allocated.ok).toBe(true);
    expect(allocated.record.appId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('bindEngineId then unbindEngineId leaves engineSessionId null and pin, title and directory as they were', () => {
    const { record } = index.sessions.createForLaunch(LAUNCH);
    const appId = record.appId;
    index.sessions.setPinned(appId, true);
    index.sessions.update(appId, { title: { text: 'Named', source: 'user' } });
    const engineId = sessionIdFor(77);
    expect(index.sessions.bindEngineId(appId, engineId).engineSessionId).toBe(engineId);
    expect(index.sessions.getByEngineId(engineId)?.appId).toBe(appId);
    const unbound = index.sessions.unbindEngineId(appId);
    expect(unbound).toMatchObject({ engineSessionId: null, pinned: true, title: { text: 'Named', source: 'user' }, directory: '/nowhere/launch' });
    expect(index.sessions.getByEngineId(engineId)).toBeNull();
    expect(bindings).toEqual([
      [appId, engineId],
      [appId, null],
    ]);
    // A transcript later discovered under that engine id becomes a fresh record.
    const later = index.sessions.upsertFromSummary(summary({ sessionId: engineId }));
    expect(later.created).toBe(true);
    expect(later.record.appId).not.toBe(appId);
  });

  it('refuses to bind an engine id another record holds', () => {
    const s = summary();
    index.sessions.upsertFromSummary(s);
    const { record } = index.sessions.createForLaunch(LAUNCH);
    expect(() => index.sessions.bindEngineId(record.appId, s.sessionId)).toThrow(/already bound/);
    expect(index.sessions.get(record.appId)?.engineSessionId).toBeNull();
  });

  it('applyEngineStatus updates the engine id, holder, gateway, model and permission mode', () => {
    const { record } = index.sessions.createForLaunch(LAUNCH);
    const engineId = sessionIdFor(78);
    const applied = index.sessions.applyEngineStatus(record.appId, {
      engineSessionId: engineId,
      holder: { kind: 'self' },
      gateway: { routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'enabled' },
      model: { requested: 'opus', resolved: 'claude-opus-5' },
      permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_unavailable' },
      engineVersion: '2.1.283',
    });
    expect(applied).toMatchObject({
      engineSessionId: engineId,
      holder: { kind: 'self' },
      gateway: { routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'enabled' },
      model: { requested: 'opus', resolved: 'claude-opus-5' },
      permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_unavailable' },
      engineVersion: '2.1.283',
    });
    expect(changes.at(-1)?.[1]).toBe('live');
    expect(bindings).toEqual([[record.appId, engineId]]);
  });

  it('markSeen moves lastSeen and clears unread; setUnread and setPinned set their flags', () => {
    const { record } = index.sessions.upsertFromSummary(summary());
    expect(index.sessions.setUnread(record.appId, true).unread).toBe(true);
    const seen = index.sessions.markSeen(record.appId, { messageUuid: 'm1' as MessageUuid, at: '2026-09-28T12:00:00.000Z' });
    expect(seen).toMatchObject({ unread: false, lastSeen: { messageUuid: 'm1', at: '2026-09-28T12:00:00.000Z' } });
    expect(index.sessions.setPinned(record.appId, true).pinned).toBe(true);
    expect(index.sessions.update(record.appId, { archived: true }).archived).toBe(true);
    expect(index.sessions.list()).toEqual([]);
    expect(index.sessions.list({ includeArchived: true })).toHaveLength(1);
  });

  it('a transcript removed from disk archives the record and keeps it', () => {
    const s = summary();
    const { record } = index.sessions.upsertFromSummary(s);
    expect(index.sessions.markTranscriptRemoved(s.sessionId)).toMatchObject({ appId: record.appId, archived: true });
    expect(index.sessions.bindings()).toEqual([{ sessionId: s.sessionId, appSessionId: record.appId, size: null, mtimeMs: null }]);
    expect(index.sessions.markTranscriptRemoved(sessionIdFor(12345))).toBeNull();
  });

  it('createReplay makes a kind replay record titled by the tool; remove deletes it and reports removed', () => {
    const appId = randomUUID() as AppSessionId;
    const record = index.sessions.createReplay({ appId, sessionId: 'rp_1' as SessionId, title: 'workflow' });
    expect(record).toMatchObject({ appId, engineSessionId: 'rp_1', title: { text: 'workflow', source: 'tool' }, holder: { kind: 'none' } });
    expect(changes.at(-1)?.[1]).toBe('replay');
    index.sessions.remove(appId);
    expect(index.sessions.get(appId)).toBeNull();
    expect(changes.at(-1)).toEqual([record, 'removed']);
  });

  it('an unknown app session id is an answer, not an invariant', () => {
    const unknown = randomUUID() as AppSessionId;
    const message = `unknown app session: ${unknown}`;
    expect(index.sessions.get(unknown)).toBeNull();
    expect(() => index.sessions.update(unknown, { archived: true })).toThrow(message);
    expect(() => index.sessions.setPinned(unknown, true)).toThrow(message);
    expect(() => index.sessions.markSeen(unknown, { messageUuid: null, at: 'now' })).toThrow(message);
    expect(() => index.sessions.bindEngineId(unknown, sessionIdFor(1))).toThrow(message);
    expect(() => index.sessions.unbindEngineId(unknown)).toThrow(message);
    expect(() => index.sessions.applyEngineStatus(unknown, {})).toThrow(message);
  });

  it('one notification per record per transaction, after commit, with the first cause; nothing on rollback', () => {
    const s = summary();
    index.transaction(() => {
      const { record } = index.sessions.upsertFromSummary(s);
      index.sessions.setUnread(record.appId, true);
      expect(changes).toEqual([]);
    });
    expect(changes).toHaveLength(1);
    expect(changes[0][1]).toBe('discovered');
    expect(changes[0][0].unread).toBe(true);

    changes.length = 0;
    expect(() =>
      index.transaction(() => {
        index.sessions.setPinned(changes.length === 0 ? index.sessions.getByEngineId(s.sessionId)!.appId : ('' as AppSessionId), true);
        throw new Error('abandoned');
      }),
    ).toThrow('abandoned');
    expect(changes).toEqual([]);
    expect(index.sessions.getByEngineId(s.sessionId)?.pinned).toBe(false);
  });
});
