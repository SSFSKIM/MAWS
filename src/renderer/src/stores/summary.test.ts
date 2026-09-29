import { describe, expect, it, vi } from 'vitest';
import { fakeClient } from '../../../../test/support/fake-client';
import { createSummaryStore } from './summary';

const DELAY = 5;
const wait = (ms = DELAY * 4) => new Promise((resolve) => setTimeout(resolve, ms));

describe('summary store', () => {
  it('reads summary.sections once, at first use', async () => {
    const fake = fakeClient({ 'layout.get': { value: { version: 1, collapsed: ['sources', 'push'] } } });
    const store = createSummaryStore(fake.client, { writeDelayMs: DELAY });
    expect(fake.invoked('layout.get')).toEqual([]);
    await store.getState().load();
    await store.getState().load();
    expect(fake.invoked('layout.get')).toEqual([{ key: 'summary.sections' }]);
    expect([...store.getState().collapsed]).toEqual(['sources', 'push']);
    expect(store.getState().loaded).toBe(true);
  });

  it('treats an absent or invalid value as everything expanded', async () => {
    for (const value of [null, { version: 1, collapsed: ['nope'] }, { version: 2, collapsed: [] }, ['sources']]) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = createSummaryStore(fakeClient({ 'layout.get': { value } }).client, { writeDelayMs: DELAY });
      await store.getState().load();
      expect(store.getState().collapsed.size, JSON.stringify(value)).toBe(0);
      expect(store.getState().loaded).toBe(true);
      warn.mockRestore();
    }
  });

  it('writes summary.sections once, a debounce after the last toggle', async () => {
    const fake = fakeClient({ 'layout.get': { value: null }, 'layout.set': undefined });
    const store = createSummaryStore(fake.client, { writeDelayMs: DELAY });
    await store.getState().load();
    store.getState().toggle('sources');
    store.getState().toggle('push');
    store.getState().toggle('push');
    expect(store.getState().collapsed.has('sources')).toBe(true);
    expect(fake.invoked('layout.set')).toEqual([]);
    await wait();
    expect(fake.invoked('layout.set')).toEqual([{ key: 'summary.sections', value: { version: 1, collapsed: ['sources'] } }]);
  });

  it('keeps a toggle made before the read answered', async () => {
    const fake = fakeClient({ 'layout.set': undefined });
    const store = createSummaryStore(fake.client, { writeDelayMs: DELAY });
    void store.getState().load();
    store.getState().toggle('environment');
    await fake.reply('layout.get', { value: { version: 1, collapsed: ['sources'] } });
    expect([...store.getState().collapsed]).toEqual(['environment']);
    await wait();
    expect(fake.invoked('layout.set')).toEqual([{ key: 'summary.sections', value: { version: 1, collapsed: ['environment'] } }]);
  });

  it('flushes a pending write when the page unloads', async () => {
    const fake = fakeClient({ 'layout.get': { value: null }, 'layout.set': undefined });
    const store = createSummaryStore(fake.client, { writeDelayMs: 10_000 });
    await store.getState().load();
    store.getState().toggle('background');
    window.dispatchEvent(new Event('beforeunload'));
    expect(fake.invoked('layout.set')).toEqual([{ key: 'summary.sections', value: { version: 1, collapsed: ['background'] } }]);
    window.dispatchEvent(new Event('beforeunload'));
    expect(fake.invoked('layout.set')).toHaveLength(1);
  });
});
