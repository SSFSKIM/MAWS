// The idle collection (P5 Decision Log 124's lever): an entry into idle collects once, after its caller's turn; a busy
// return before then collects nothing; a later entry collects again only if the heap grew; and the real collection's
// gc stays private to its module.
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { GROWTH_BYTES, idleCollector, lastResortCollect } from './idle-collect';

function rig(heap: { bytes: number }) {
  const queued: (() => void)[] = [];
  const lines: string[] = [];
  const collect = vi.fn(() => void (heap.bytes = 10 * GROWTH_BYTES));
  const collector = idleCollector({ log: (line) => lines.push(line), collect, heapBytes: () => heap.bytes, defer: (run) => queued.push(run), now: () => 0 });
  const turn = () => queued.splice(0).forEach((run) => run());
  return { collector, collect, lines, turn, queued };
}

describe('the idle collector', () => {
  it('collects once at an entry, after the turn that told it, and not again while it stays idle', () => {
    const heap = { bytes: 40 * GROWTH_BYTES };
    const { collector, collect, lines, turn, queued } = rig(heap);
    collector.set(true);
    collector.set(true);
    expect(collect).not.toHaveBeenCalled();
    expect(queued).toHaveLength(1);
    turn();
    expect(collect).toHaveBeenCalledOnce();
    expect(lines).toEqual(['idle: collected in 0 ms, heap 40.0 to 10.0 MiB']);
    collector.set(true);
    turn();
    expect(collect).toHaveBeenCalledOnce();
  });

  it('collects nothing when it is busy again before the turn ends', () => {
    const { collector, collect, turn } = rig({ bytes: 40 * GROWTH_BYTES });
    collector.set(true);
    collector.set(false);
    turn();
    expect(collect).not.toHaveBeenCalled();
  });

  it('collects at a later entry when the heap grew since the last collection, and skips one that finds it as left', () => {
    const heap = { bytes: 40 * GROWTH_BYTES };
    const { collector, collect, turn } = rig(heap);
    collector.set(true);
    turn();
    collector.set(false);
    heap.bytes += GROWTH_BYTES - 1; // a client came and went
    collector.set(true);
    turn();
    expect(collect).toHaveBeenCalledOnce();
    collector.set(false);
    heap.bytes += 1; // an active phase grew it
    collector.set(true);
    turn();
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('logs a collection that fails and tries again at the next entry', () => {
    const queued: (() => void)[] = [];
    const lines: string[] = [];
    const collect = vi.fn().mockImplementationOnce(() => { throw new Error('no extension'); });
    const collector = idleCollector({ log: (line) => lines.push(line), collect, heapBytes: () => 0, defer: (run) => queued.push(run) });
    collector.set(true);
    queued.splice(0).forEach((run) => run());
    collector.set(false);
    collector.set(true);
    queued.splice(0).forEach((run) => run());
    expect(collect).toHaveBeenCalledTimes(2);
    expect(lines[0]).toBe('idle: the collection failed: no extension');
  });
});

describe('the last-resort collection', () => {
  it('runs V8’s collection with a gc no other context can reach', () => {
    const global = typeof (globalThis as { gc?: unknown }).gc; // 'function' only in a process started with --expose-gc
    lastResortCollect();
    lastResortCollect();
    expect(typeof (globalThis as { gc?: unknown }).gc).toBe(global);
    if (global === 'undefined') expect(runInNewContext('typeof gc')).toBe('undefined');
  });
});
