import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { item, record } from '../../../../test/support/builders';
import { ev } from '../../../../test/support/events';
import { fakeClient } from '../../../../test/support/fake-client';
import { swapOf } from '../composer/docked/swap';
import { createAttentionStore, REQUEST_RETRY_MS, selectNeedsYou, selectPendingOf } from './attention';

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

  it('retries a failed read once, after REQUEST_RETRY_MS, and caches what the retry reads', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createAttentionStore();
    const fake = fakeClient();
    const load = store.getState().loadRequest(fake.client, older);
    void fake.fail('attention.request', 'no host'); // its settle is a timer, run below
    await vi.advanceTimersByTimeAsync(REQUEST_RETRY_MS - 1);
    expect(fake.pending('attention.request')).toBe(0);
    void store.getState().loadRequest(fake.client, older); // shares the read under way, retry included
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.pending('attention.request')).toBe(1);
    void fake.reply('attention.request', { event });
    await vi.advanceTimersByTimeAsync(0);
    await load;
    expect(store.getState().requests.get(older.id)).toBe(event);
    expect(store.getState().unreadable.size).toBe(0);
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('a read that fails twice is cached as unreadable, so the docked swap shows it as a notice instead of waiting', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createAttentionStore();
    const fake = fakeClient();
    const load = store.getState().loadRequest(fake.client, older);
    void fake.fail('attention.request', 'no host'); // its settle is a timer, run below
    await vi.advanceTimersByTimeAsync(REQUEST_RETRY_MS);
    void fake.fail('attention.request', 'still no host');
    await vi.advanceTimersByTimeAsync(0);
    await load;
    expect(store.getState().requests.get(older.id)).toBeNull();
    expect(store.getState().unreadable.get(older.id)).toBe('still no host');
    expect(swapOf([older], store.getState().requests)).toMatchObject({ item: null, notice: older, unread: [] });
    await store.getState().loadRequest(fake.client, older); // asks nothing more
    expect(fake.invoked('attention.request')).toHaveLength(2);
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('Retry forgets an unreadable read and asks again; an answered or retired item’s failure is forgotten', async () => {
    const store = createAttentionStore();
    const fake = fakeClient();
    store.getState().applySnapshot([older, newer]);
    store.setState({ requests: new Map([[older.id, null], [newer.id, null]]), unreadable: new Map([[older.id, 'no host'], [newer.id, 'no host']]) });
    const retry = store.getState().retryRequest(fake.client, older);
    expect(store.getState().requests.has(older.id)).toBe(false); // unread again: the docked swap waits for it
    expect(store.getState().unreadable.has(older.id)).toBe(false);
    await fake.reply('attention.request', { event });
    await retry;
    expect(store.getState().requests.get(older.id)).toBe(event);
    store.getState().applyChanged({ appSessionId: S, items: [older, { ...newer, state: 'delivered' }] }); // newer answered
    expect(store.getState().unreadable.size).toBe(0);
    expect(store.getState().requests.has(newer.id)).toBe(false);
    expect(store.getState().requests.get(older.id)).toBe(event); // a read request stays cached
  });
});

// W4: the question stepper's draft lives beside the request until the item is no longer open.
describe('a question card’s draft', () => {
  it('is kept while its item is open (pending or delivered) and dropped once it retires or leaves', () => {
    const store = createAttentionStore();
    store.getState().applySnapshot([older, newer]);
    const draft = { step: 1, reached: 1, selected: { q: ['Red'] }, other: {} };
    store.getState().setDraft(newer.id, draft);
    store.getState().setDraft(older.id, draft);
    store.getState().applyChanged({ appSessionId: S, items: [older, { ...newer, state: 'delivered' }] });
    expect(store.getState().drafts.get(newer.id)).toBe(draft);
    store.getState().applyChanged({ appSessionId: S, items: [older, { ...newer, state: 'retired' }] });
    expect(store.getState().drafts.has(newer.id)).toBe(false);
    expect(store.getState().drafts.get(older.id)).toBe(draft);
    store.getState().beginSnapshot();
    store.getState().applySnapshot([]);
    expect(store.getState().drafts.size).toBe(0);
  });
});
