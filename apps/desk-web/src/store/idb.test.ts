// Opening the desk's database (P5 O13 M3): an older tab still holding version 1 (its code has no `versionchange`
// handler) blocks the upgrade to version 2; the page says so, asking for the other desk tabs to be closed, and carries
// on once the upgrade goes through.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type FakeRequest = { result: { onversionchange: (() => void) | null; close(): void; objectStoreNames: { contains(): boolean }; createObjectStore(): void }; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void; onblocked?: () => void; error: null };

let request: FakeRequest;
beforeEach(() => {
  vi.resetModules();
  request = { result: { onversionchange: null, close: () => {}, objectStoreNames: { contains: () => true }, createObjectStore: () => {} }, error: null };
  vi.stubGlobal('indexedDB', { open: () => request });
});
afterEach(() => vi.unstubAllGlobals());

it('says the upgrade waits on another tab while it is blocked, and clears that once the database opens', async () => {
  const { openDesk, useDeskStorage } = await import('./idb');
  const opened = openDesk();
  expect(useDeskStorage.getState().blocked).toBe(false);
  request.onblocked!();
  expect(useDeskStorage.getState().blocked).toBe(true);
  request.onupgradeneeded!();
  request.onsuccess!();
  await expect(opened).resolves.toBe(request.result);
  expect(useDeskStorage.getState().blocked).toBe(false);
});
