// The People toggle's set (P5 O8 M5, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The People toggle"):
// read once from the `sidebar.people` layout key, written 250 ms after the last change, as `summary.sections` is.
import { describe, expect, it, vi } from 'vitest';
import { fakeClient } from '../../../../test/support/fake-client';
import type { RowKey } from './org-projects';
import { createPeopleStore } from './people';

const DELAY = 5;
const wait = (ms = DELAY * 4) => new Promise((resolve) => setTimeout(resolve, ms));
const MAWS = 'remote:github.com/o/maws' as RowKey;
const NOTES = 'remote:github.com/o/notes' as RowKey;
const STUDIO = 'machine:studio' as RowKey;

describe('people store', () => {
  it('reads sidebar.people once, at first use, every toggle off until then', async () => {
    const fake = fakeClient({ 'layout.get': { value: { version: 1, on: [MAWS, STUDIO] } } });
    const store = createPeopleStore(fake.client, { writeDelayMs: DELAY });
    expect(store.getState().on.size).toBe(0);
    expect(fake.invoked('layout.get')).toEqual([]);
    await store.getState().load();
    await store.getState().load();
    expect(fake.invoked('layout.get')).toEqual([{ key: 'sidebar.people' }]);
    expect([...store.getState().on]).toEqual([MAWS, STUDIO]);
  });

  it('treats an absent or invalid value as every toggle off', async () => {
    for (const value of [null, { version: 1, on: [3] }, { version: 2, on: [] }, [MAWS]]) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = createPeopleStore(fakeClient({ 'layout.get': { value } }).client, { writeDelayMs: DELAY });
      await store.getState().load();
      expect(store.getState().on.size, JSON.stringify(value)).toBe(0);
      warn.mockRestore();
    }
  });

  it('writes sidebar.people once, a debounce after the last toggle', async () => {
    const fake = fakeClient({ 'layout.get': { value: { version: 1, on: [NOTES] } }, 'layout.set': undefined });
    const store = createPeopleStore(fake.client, { writeDelayMs: DELAY });
    await store.getState().load();
    store.getState().toggle(MAWS);
    store.getState().toggle(STUDIO);
    store.getState().toggle(STUDIO);
    expect(store.getState().on.has(MAWS)).toBe(true);
    expect(fake.invoked('layout.set')).toEqual([]);
    await wait();
    expect(fake.invoked('layout.set')).toEqual([{ key: 'sidebar.people', value: { version: 1, on: [NOTES, MAWS] } }]);
  });

  it('applies the state a toggle before the read answered asked for over what it reads, and writes only after it', async () => {
    const fake = fakeClient({ 'layout.set': undefined });
    const store = createPeopleStore(fake.client, { writeDelayMs: DELAY });
    void store.getState().load();
    store.getState().toggle(MAWS);
    store.getState().toggle(NOTES);
    expect([...store.getState().on]).toEqual([MAWS, NOTES]);
    await wait();
    expect(fake.invoked('layout.set')).toEqual([]); // a write now would drop what the read brings
    await fake.reply('layout.get', { value: { version: 1, on: [NOTES, STUDIO] } });
    expect([...store.getState().on]).toEqual([NOTES, STUDIO, MAWS]);
    await wait();
    expect(fake.invoked('layout.set')).toEqual([{ key: 'sidebar.people', value: { version: 1, on: [NOTES, STUDIO, MAWS] } }]);
  });

  it('keeps a stored key on when an early toggle asked for it on, and leaves untouched stored keys alone', async () => {
    const fake = fakeClient({ 'layout.set': undefined });
    const store = createPeopleStore(fake.client, { writeDelayMs: DELAY });
    void store.getState().load();
    store.getState().toggle(MAWS); // shown off before the read, so "Show": the person wants it on
    await fake.reply('layout.get', { value: { version: 1, on: [MAWS, STUDIO] } });
    expect(store.getState().on.has(MAWS)).toBe(true);
    expect(store.getState().on.has(STUDIO)).toBe(true);
    await wait();
    expect(fake.invoked('layout.set')).toEqual([{ key: 'sidebar.people', value: { version: 1, on: [MAWS, STUDIO] } }]);
  });

  it('ends off after an early double toggle, on then off, whatever the read holds', async () => {
    const fake = fakeClient({ 'layout.set': undefined });
    const store = createPeopleStore(fake.client, { writeDelayMs: DELAY });
    void store.getState().load();
    store.getState().toggle(MAWS);
    store.getState().toggle(MAWS);
    await fake.reply('layout.get', { value: { version: 1, on: [MAWS, STUDIO] } });
    expect([...store.getState().on]).toEqual([STUDIO]);
    await wait();
    expect(fake.invoked('layout.set')).toEqual([{ key: 'sidebar.people', value: { version: 1, on: [STUDIO] } }]);
  });

  it('flushes a pending write when the page unloads', async () => {
    const fake = fakeClient({ 'layout.get': { value: null }, 'layout.set': undefined });
    const store = createPeopleStore(fake.client, { writeDelayMs: 10_000 });
    await store.getState().load();
    store.getState().toggle(STUDIO);
    window.dispatchEvent(new Event('beforeunload'));
    expect(fake.invoked('layout.set')).toEqual([{ key: 'sidebar.people', value: { version: 1, on: [STUDIO] } }]);
    window.dispatchEvent(new Event('beforeunload'));
    expect(fake.invoked('layout.set')).toHaveLength(1);
  });
});
