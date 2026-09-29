import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, AttentionId, MessageUuid, RequestId, SessionId } from '@shared/graph/ids';
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
    index.sessions.onBinding((change) => bindings.push([change.appSessionId, change.sessionId]));
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

  it('upserts 4,000 synthetic summaries inside one transaction in under 500 ms of CPU time', () => {
    const summaries = Array.from({ length: 4_000 }, (_, i) => summary({ sessionId: sessionIdFor(i + 1), customTitle: i % 3 === 0 ? `t${i}` : null }));
    // The bound is on the work the upserts cost (this process's CPU time; vitest runs each file in its own process), so
    // a loaded machine's scheduling does not decide it.
    const cpu = process.cpuUsage();
    const started = performance.now();
    index.transaction(() => {
      for (const s of summaries) index.sessions.upsertFromSummary(s);
    });
    const spent = process.cpuUsage(cpu);
    const elapsed = performance.now() - started;
    expect(index.sessions.list()).toHaveLength(4_000);
    expect((spent.user + spent.system) / 1000).toBeLessThan(500);
    expect(elapsed).toBeLessThan(2000); // a sanity bound on the wall clock, as M5's instant pin keeps
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

  it('a live process takes over the record discovery made for its transcript first; an engine id another MAWS process holds is refused', () => {
    // Discovery can see the new transcript before the status naming its id arrives: that record yields, its facts move over.
    const s = summary({ customTitle: 'Seen first' });
    const discovered = index.sessions.upsertFromSummary(s).record;
    const { record } = index.sessions.createForLaunch(LAUNCH);
    bindings.length = 0;
    changes.length = 0;
    const bound = index.sessions.bindEngineId(record.appId, s.sessionId);
    expect(bound).toMatchObject({ appId: record.appId, engineSessionId: s.sessionId, title: { text: 'Seen first', source: 'user' } });
    expect(index.sessions.get(discovered.appId)).toBeNull();
    expect(index.sessions.summaryOf(record.appId)?.sessionId).toBe(s.sessionId);
    expect(bindings).toEqual([
      [discovered.appId, null],
      [record.appId, s.sessionId],
    ]);
    expect(changes.map(([r, cause]) => [r.appId, cause])).toEqual([
      [discovered.appId, 'removed'],
      [record.appId, 'live'],
    ]);

    // A record carrying the owner's own state (an exited MAWS session with a pin, say: holder `none`) never yields.
    const exited = summary();
    const kept = index.sessions.upsertFromSummary(exited).record;
    index.sessions.setPinned(kept.appId, true);
    const claimant = index.sessions.createForLaunch(LAUNCH).record;
    expect(() => index.sessions.bindEngineId(claimant.appId, exited.sessionId)).toThrow(/already bound/);
    expect(index.sessions.get(kept.appId)).toMatchObject({ engineSessionId: exited.sessionId, pinned: true });
    // Nor does one with a draft, a MAWS title, or a last-seen cursor.
    for (const mark of [
      (id: AppSessionId) => index.drafts.set(id, { doc: { type: 'doc' }, attachments: [], updatedAt: '2026-09-28T10:00:00.000Z' }),
      (id: AppSessionId) => index.sessions.update(id, { title: { text: 'Mine', source: 'user' } }),
      (id: AppSessionId) => index.sessions.markSeen(id, { messageUuid: null, at: '2026-09-28T10:00:00.000Z' }),
      (id: AppSessionId) => index.sessions.update(id, { archived: true }),
      (id: AppSessionId) =>
        index.attention.replaceForSession(id, [
          {
            id: 'att-1' as AttentionId,
            appSessionId: id,
            sessionId: null,
            kind: 'permission',
            request: { requestId: 'req-1' as RequestId, toolUseId: null, taskId: null, agentId: null },
            summary: 'Allow?',
            createdAt: '2026-09-28T10:00:00.000Z',
            state: 'pending',
            stateChangedAt: '2026-09-28T10:00:00.000Z',
            expiresAt: null,
          },
        ]),
    ]) {
      const s2 = summary();
      const marked = index.sessions.upsertFromSummary(s2).record;
      mark(marked.appId);
      expect(() => index.sessions.bindEngineId(claimant.appId, s2.sessionId)).toThrow(/already bound/);
      expect(index.sessions.get(marked.appId)?.engineSessionId).toBe(s2.sessionId);
    }

    // Two MAWS processes claiming one engine session is a conflict to surface, not to merge.
    const other = index.sessions.createForLaunch(LAUNCH).record;
    index.sessions.applyEngineStatus(other.appId, { holder: { kind: 'self' } });
    const engineId = sessionIdFor(78);
    index.sessions.bindEngineId(other.appId, engineId);
    const third = index.sessions.createForLaunch(LAUNCH).record;
    expect(() => index.sessions.bindEngineId(third.appId, engineId)).toThrow(/already bound/);
    expect(index.sessions.get(third.appId)?.engineSessionId).toBeNull();
    expect(index.sessions.get(other.appId)?.engineSessionId).toBe(engineId);
  });

  it('a second engine id for a bound record (the engine\'s /clear) rebinds it, and the old transcript becomes a record of its own', () => {
    const { record } = index.sessions.createForLaunch(LAUNCH);
    const appId = record.appId;
    const a = summary({ customTitle: 'Before clear', lastRecordAt: '2026-09-28T10:00:00.000Z' });
    index.sessions.bindEngineId(appId, a.sessionId);
    index.sessions.upsertFromSummary(a);
    index.sessions.setPinned(appId, true);
    index.sessions.update(appId, { title: { text: 'Named in MAWS', source: 'user' } });
    bindings.length = 0;

    const b = sessionIdFor(79);
    const rebound = index.sessions.bindEngineId(appId, b);
    expect(rebound).toMatchObject({ appId, engineSessionId: b, pinned: true, title: { text: 'Named in MAWS', source: 'user' } });
    // The app session no longer describes A's transcript: nothing tells the host A's size and mtime under this app id.
    expect(index.sessions.summaryOf(appId)).toBeNull();
    expect(index.sessions.bindings().find((binding) => binding.appSessionId === appId)).toEqual({ sessionId: b, appSessionId: appId, size: null, mtimeMs: null });
    const history = index.sessions.getByEngineId(a.sessionId)!;
    expect(history.appId).not.toBe(appId);
    expect(history).toMatchObject({ pinned: false, title: { text: 'Before clear', source: 'user' } });
    expect(index.sessions.summaryOf(history.appId)).toEqual(a);
    expect(bindings).toEqual([
      [appId, b],
      [history.appId, a.sessionId],
    ]);

    // B's first summary fills the record; A's custom title was the engine's, so the MAWS rename holds.
    const next = index.sessions.upsertFromSummary(summary({ sessionId: b, customTitle: null, lastRecordAt: '2026-09-28T11:00:00.000Z' }));
    // A first sighting of the new transcript, not an advance: last_record_at was cleared with the old transcript's facts.
    expect(next).toMatchObject({ created: false, advanced: false, record: { appId, title: { text: 'Named in MAWS', source: 'user' } } });
  });

  it('a rebind clears the old transcript\'s engine titles and text, so no two rows carry its title', () => {
    const { record } = index.sessions.createForLaunch(LAUNCH);
    const a = summary({ customTitle: 'Old custom', aiTitle: 'Old AI', firstPrompt: 'old prompt', lastAssistantText: 'old reply' });
    index.sessions.bindEngineId(record.appId, a.sessionId);
    index.sessions.upsertFromSummary(a);
    const rebound = index.sessions.bindEngineId(record.appId, sessionIdFor(80));
    expect(rebound.title).toEqual({ text: '', source: 'none' });
    expect(index.sessions.list().filter((r) => r.title.text === 'Old custom').map((r) => r.engineSessionId)).toEqual([a.sessionId]);
    const reader = new DatabaseSync(join(dir.path, 'index.sqlite'), { readOnly: true });
    const row = { ...reader.prepare('SELECT custom_title, ai_title, first_prompt, last_assistant_text, last_record_at FROM sessions WHERE app_id = ?').get(record.appId) };
    reader.close();
    expect(row).toEqual({ custom_title: null, ai_title: null, first_prompt: null, last_assistant_text: null, last_record_at: null });
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
