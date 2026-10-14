// The start import's gate (M6b fix wave 1; Decision Log 39a): what waits on the X12 import a host start runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactStore } from '../documents/store';
import { holdForImport, importSettled, importSettledWithin } from './import-gate';

const store = () => ({}) as ArtifactStore;
const settled = async (promise: Promise<unknown>) => {
  let done = false;
  void promise.then(() => (done = true));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return done;
};

describe('the start import’s gate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is open for a store no import holds', async () => {
    expect(await settled(importSettled(store()))).toBe(true);
  });

  it('holds until the import lands, for that store only', async () => {
    const held = store();
    let land!: () => void;
    holdForImport(held, new Promise<void>((resolve) => (land = resolve)));
    expect(await settled(importSettled(held))).toBe(false);
    expect(await settled(importSettled(store()))).toBe(true);
    land();
    expect(await settled(importSettled(held))).toBe(true);
  });

  it('opens when the import fails, so a failed import wedges nothing', async () => {
    const held = store();
    let fail!: (error: Error) => void;
    holdForImport(held, new Promise<void>((_, reject) => (fail = reject)));
    const waiting = importSettled(held);
    fail(new Error('the tree could not be listed'));
    await expect(waiting).resolves.toBeUndefined();
  });

  it('waits at most the bound when asked to', async () => {
    const held = store();
    holdForImport(held, new Promise<void>(() => {}));
    const waiting = importSettledWithin(held, 8_000);
    expect(await settled(waiting)).toBe(false);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await settled(waiting)).toBe(true);
  });
});
