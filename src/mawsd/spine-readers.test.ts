// The apps that read the machine's spine (P5 O3-D M6 fix round 1): an entry per announced app, gone once its app has.
import { describe, expect, it } from 'vitest';
import { SpineReaders } from './spine-readers';

describe('the spine readers', () => {
  it('reads an announced pid at its start, and prunes each app that has gone (dead, or its pid reused) at the next change', () => {
    const live = new Map<number, string>([[101, 'start-101'], [102, 'start-102']]);
    const readers = new SpineReaders((pid) => live.get(pid) ?? null);
    readers.announce(101);
    readers.announce(102);
    expect([readers.reads(101), readers.reads(102), readers.reads(103)]).toEqual([true, true, false]);
    live.delete(101); // the first app quit
    live.set(102, 'start-102-again'); // the second's pid taken by another process
    expect(readers.reads(102), 'a reused pid reads no spine').toBe(false);
    readers.prune();
    expect(readers.size, 'both gone').toBe(0);
    live.set(104, 'start-104');
    readers.announce(104);
    readers.prune();
    expect(readers.size, 'a live app stays').toBe(1);
  });
});
