import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { item, record } from '../../../../test/support/builders';
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
