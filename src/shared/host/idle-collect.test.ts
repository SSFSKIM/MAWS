// The idle collection (P5 Decision Log 124's lever): an entry into idle collects once, after its caller's turn; a busy
// return before then collects nothing; a later entry collects again only if the heap grew, in use or in pages; a
// dropped holding collects while it stays idle; a stopped collector collects nothing again; and the real collection's
// gc stays private to its module.
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { GROWTH_BYTES, idleCollector, lastResortCollect, type HeapSize } from './idle-collect';

const MIB = GROWTH_BYTES;

function rig(heap: HeapSize = { used: 20 * MIB, physical: 40 * MIB }) {
  const queued: (() => void)[] = [];
  const lines: string[] = [];
  const collect = vi.fn(() => void Object.assign(heap, { used: 5 * MIB, physical: 10 * MIB }));
  const collector = idleCollector({ log: (line) => lines.push(line), collect, heap: () => ({ ...heap }), defer: (run) => queued.push(run), now: () => 0 });
  const turn = () => queued.splice(0).forEach((run) => run());
  return { heap, collector, collect, lines, turn, queued };
}

describe('the idle collector', () => {
  it('collects once at an entry, after the turn that told it, and not again while it stays idle', () => {
    const { collector, collect, lines, turn, queued } = rig();
    collector.set(true);
    collector.set(true);
    expect(collect).not.toHaveBeenCalled();
    expect(queued).toHaveLength(1);
    turn();
    expect(collect).toHaveBeenCalledOnce();
    expect(lines).toEqual(['idle: collected in 0 ms, heap 40.0 to 10.0 MiB (used 20.0 to 5.0)']);
    collector.set(true);
    turn();
    expect(collect).toHaveBeenCalledOnce();
  });

  it('collects nothing when it is busy again before the turn ends', () => {
    const { collector, collect, turn } = rig();
    collector.set(true);
    collector.set(false);
    turn();
    expect(collect).not.toHaveBeenCalled();
  });

  it('skips a later entry that finds the heap as the last collection left it: a client that came and went', () => {
    const { heap, collector, collect, turn } = rig();
    collector.set(true);
    turn();
    collector.set(false);
    heap.used += MIB - 1;
    heap.physical += MIB - 1;
    collector.set(true);
    turn();
    expect(collect).toHaveBeenCalledOnce();
  });

  it('collects at a later entry when the heap’s pages grew since the last collection', () => {
    const { heap, collector, collect, turn } = rig();
    collector.set(true);
    turn();
    collector.set(false);
    heap.physical += MIB;
    collector.set(true);
    turn();
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('collects at a later entry when its use grew since the last collection, within the pages V8 kept', () => {
    const { heap, collector, collect, turn } = rig();
    collector.set(true);
    turn();
    collector.set(false);
    heap.used += MIB; // an active phase allocated into the pages the last collection kept
    collector.set(true);
    turn();
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('collects while it stays idle when a holding is dropped, whatever the heap reads, and only while idle', () => {
    const { collector, collect, turn } = rig();
    collector.set(true);
    turn();
    collector.dropped(); // a released session's transcript: garbage that neither size shows
    turn();
    expect(collect).toHaveBeenCalledTimes(2);
    collector.set(false);
    collector.dropped();
    turn();
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('an entry and a dropped holding in one turn collect once, past the guard', () => {
    const { collector, collect, turn, queued } = rig();
    collector.set(true);
    turn();
    collector.set(false);
    collector.set(true);
    collector.dropped();
    expect(queued).toHaveLength(1);
    turn();
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('collects nothing once stopped, not even what was already queued', () => {
    const { collector, collect, turn } = rig();
    collector.set(true);
    collector.stop();
    turn();
    collector.set(false);
    collector.set(true);
    collector.dropped();
    turn();
    expect(collect).not.toHaveBeenCalled();
  });

  it('logs a collection that fails and tries again at the next entry', () => {
    const queued: (() => void)[] = [];
    const lines: string[] = [];
    const collect = vi.fn().mockImplementationOnce(() => { throw new Error('no extension'); });
    const collector = idleCollector({ log: (line) => lines.push(line), collect, heap: () => ({ used: 0, physical: 0 }), defer: (run) => queued.push(run) });
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
