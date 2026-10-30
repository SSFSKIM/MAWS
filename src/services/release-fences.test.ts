import { describe, expect, it } from 'vitest';
import { ReleaseFences } from './release-fences';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('ReleaseFences', () => {
  it('tells a step its owner was released while it ran, and an unreleased one that it was not', async () => {
    const fences = new ReleaseFences<string>();
    const gate = deferred();
    const straddling = fences.hold('a', async (released) => (await gate.promise, released()));
    const untouched = fences.hold('b', async (released) => (await gate.promise, released()));
    fences.release('a');
    gate.resolve();
    expect(await straddling).toBe(true);
    expect(await untouched).toBe(false);
  });

  it('gives a step begun after the release a fresh fence', async () => {
    const fences = new ReleaseFences<string>();
    const gate = deferred();
    const before = fences.hold('a', async (released) => (await gate.promise, released()));
    fences.release('a');
    const after = fences.hold('a', async (released) => (await gate.promise, released()));
    gate.resolve();
    expect([await before, await after]).toEqual([true, false]);
  });

  it('keeps nothing for an owner once no step holds its fence, released or not', async () => {
    const fences = new ReleaseFences<string>();
    const gate = deferred();
    const one = fences.hold('a', async () => gate.promise);
    const two = fences.hold('a', async () => gate.promise);
    void fences.hold('b', async () => {});
    expect(fences.size).toBe(2);
    gate.resolve();
    await Promise.all([one, two]);
    expect(fences.size).toBe(0);
    fences.release('c'); // an owner no step holds: nothing to keep
    const held = fences.hold('d', async () => gate.promise);
    fences.release('d');
    expect(fences.size).toBe(0);
    await held;
    expect(fences.size).toBe(0);
  });

  it('lets go of the fence when the step throws', async () => {
    const fences = new ReleaseFences<string>();
    await expect(fences.hold('a', async () => { throw new Error('status failed'); })).rejects.toThrow('status failed');
    expect(fences.size).toBe(0);
  });
});
