import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { item, record } from '../../../../test/support/builders';
import { ev } from '../../../../test/support/events';
import { fakeClient } from '../../../../test/support/fake-client';
import { createAttentionStore, selectNeedsYou, selectPendingOf } from './attention';

const S = 's1' as AppSessionId;
const older = item('s1', 'permission', '2026-09-28T09:00:00Z');
const newer = item('s1', 'question', '2026-09-28T10:00:00Z');

describe('attention snapshot and changes in both orders', () => {
  it('a change buffered while the snapshot is outstanding wins over the snapshot’s older items', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot();
    store.getState().applyChanged({ appSessionId: S, items: [newer] });
    expect(store.getState().bySession.get(S)).toBeUndefined(); // buffered, not applied
    store.getState().applySnapshot([older]);
    expect(store.getState()).toMatchObject({ loaded: true, pendingReplacements: null });
    expect(store.getState().bySession.get(S)).toEqual([newer]);
  });

  it('an empty change buffered before the snapshot leaves the session empty', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot();
    store.getState().applyChanged({ appSessionId: S, items: [] });
    store.getState().applySnapshot([older]);
    expect(store.getState().bySession.get(S)).toEqual([]);
  });

  it('keeps the last buffered change per session', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot();
    store.getState().applyChanged({ appSessionId: S, items: [older] });
    store.getState().applyChanged({ appSessionId: S, items: [newer] });
    store.getState().applySnapshot([]);
    expect(store.getState().bySession.get(S)).toEqual([newer]);
  });

  it('a change arriving after the snapshot replaces that session’s list directly', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot();
    store.getState().applySnapshot([older, item('s2', 'plan', '2026-09-28T08:00:00Z')]);
    store.getState().applyChanged({ appSessionId: S, items: [newer] });
    expect(store.getState().bySession.get(S)).toEqual([newer]);
    expect(store.getState().bySession.get('s2' as AppSessionId)).toHaveLength(1);
  });

  it('records the notification delivery main reports', () => {
    const store = createAttentionStore();
    store.getState().applyNotified({ appSessionId: S, attentionId: older.id, delivery: 'fallback', at: '2026-09-28T10:00:00Z' });
    expect(store.getState().notificationDelivery).toBe('fallback');
  });

  it('selects a session’s open items and the Needs-you rows', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot();
    store.getState().applySnapshot([older, item('s1', 'plan', '2026-09-28T08:00:00Z', { state: 'retired' })]);
    expect(selectPendingOf(store.getState(), S)).toEqual([older]);
    const sessions = { records: new Map([[S, record('s1')]]), recordsVersion: 1 };
    const rows = selectNeedsYou(store.getState(), sessions);
    expect(rows.map((r) => r.appSessionId)).toEqual([S]);
    expect(selectNeedsYou(store.getState(), sessions)).toBe(rows); // memoised while the versions stand
    store.getState().applyChanged({ appSessionId: S, items: [] });
    expect(selectNeedsYou(store.getState(), sessions)).toEqual([]);
  });
});

describe('the originating request of an item, fetched once', () => {
  const event = ev('permission.requested', { requestId: older.request.requestId, toolName: 'Read', input: { file_path: '/r/a.md' } });

  it('asks attention.request once per item, sharing a fetch in flight, and caches the answer', async () => {
    const store = createAttentionStore();
    const fake = fakeClient();
    const a = store.getState().loadRequest(fake.client, older);
    const b = store.getState().loadRequest(fake.client, older);
    expect(fake.pending('attention.request')).toBe(1);
    await fake.reply('attention.request', { event });
    await Promise.all([a, b]);
    expect(store.getState().requests.get(older.id)).toBe(event);
    await store.getState().loadRequest(fake.client, older);
    expect(fake.invoked('attention.request')).toEqual([{ appSessionId: S, requestId: older.request.requestId }]);
  });

  it('an item with no request id has no originating request and asks nothing', async () => {
    const store = createAttentionStore();
    const fake = fakeClient();
    const bare = item('s1', 'error', '2026-09-28T09:00:00Z', { request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
    await store.getState().loadRequest(fake.client, bare);
    expect(store.getState().requests.get(bare.id)).toBeNull();
    expect(fake.invoked('attention.request')).toEqual([]);
  });

  it('a failed fetch is not cached, so the next open asks again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createAttentionStore();
    const fake = fakeClient();
    const first = store.getState().loadRequest(fake.client, older);
    await fake.fail('attention.request', 'no host');
    await first;
    expect(store.getState().requests.has(older.id)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    void store.getState().loadRequest(fake.client, older);
    expect(fake.pending('attention.request')).toBe(1);
    warn.mockRestore();
  });
});
