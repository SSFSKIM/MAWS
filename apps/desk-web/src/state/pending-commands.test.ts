// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingCommands } from './pending-commands';

const own = { project: 'p', machine: 'macbook', session: 'busy', nonce: 'own-op', name: 'color', outlives: 'saved here' };
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T20:42:29Z')); });
afterEach(() => vi.useRealTimers());

describe('this browser’s unseen command receipts', () => {
  it('survives a fresh page and scopes ownership to project, machine and session', () => {
    new PendingCommands(localStorage).remember(own);
    const reopened = new PendingCommands(localStorage);
    expect(reopened.pending('p', 'macbook', 'busy')).toEqual([{ ...own, at: Date.now() }]);
    expect(reopened.pending('other', 'macbook', 'busy')).toEqual([]);
    expect(reopened.pending('p', 'mini', 'busy')).toEqual([]);
    expect(reopened.pending('p', 'macbook', 'other')).toEqual([]);
    expect(new PendingCommands().pending('p', 'macbook', 'busy')).toEqual([]); // another browser owns no replayed op
  });

  it('forgets an outcome only when it is seen, including on the next fresh page', () => {
    const receipts = new PendingCommands(localStorage);
    receipts.remember(own);
    receipts.remember({ ...own, nonce: 'still-waiting' });
    receipts.seen('other-project', own.nonce);
    expect(receipts.pending('p', 'macbook', 'busy')).toHaveLength(2);
    receipts.seen('p', own.nonce);
    expect(new PendingCommands(localStorage).pending('p', 'macbook', 'busy').map((r) => r.nonce)).toEqual(['still-waiting']);
  });

  it('expires with the hub’s 24-hour retention and bounds each project’s pending set', () => {
    const receipts = new PendingCommands(localStorage);
    receipts.remember(own);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(new PendingCommands(localStorage).pending('p', 'macbook', 'busy')).toEqual([]);
    for (let i = 0; i < 260; i++) receipts.remember({ ...own, nonce: `n${i}` });
    const kept = new PendingCommands(localStorage).pending('p', 'macbook', 'busy');
    expect(kept).toHaveLength(256);
    expect(kept[0].nonce).toBe('n4');
    expect(kept.at(-1)?.nonce).toBe('n259');
  });

  it('keeps memory usable when storage is unavailable and ignores corrupt saved records', () => {
    const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const memory = new PendingCommands(denied);
    memory.remember(own);
    expect(memory.pending('p', 'macbook', 'busy')).toHaveLength(1);
    const quota = new PendingCommands({ getItem: () => '[]', setItem() { throw new Error('quota'); } });
    quota.remember(own);
    expect(quota.pending('p', 'macbook', 'busy')).toHaveLength(1);
    const corrupt = { getItem: () => JSON.stringify([null, { ...own, at: 'yesterday' }]), setItem() {} };
    expect(new PendingCommands(corrupt).pending('p', 'macbook', 'busy')).toEqual([]);
  });
});
