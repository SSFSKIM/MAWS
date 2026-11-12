// The idle collection (P5 Decision Log 124's lever): an entry into idle collects once, after its caller's turn; a busy
// return before then collects nothing, told or found by the process's quiet asked again as it collects; a later entry
// collects again only if the heap grew, in use or in pages; a dropped holding collects while it stays idle; a stopped
// collector collects nothing again; and the real collection's gc stays private to its module. The quiet entry (Decision
// Log 273): a quiet period with clients connected collects once, never on work, past nothing grown only by the guard,
// and its clock is armed again only by activity.
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { ACTIVITY_QUIET_MS, GROWTH_BYTES, idleCollector, ioInFlight, IO_RETRIES, IO_RETRY_MS, lastResortCollect, type HeapSize } from './idle-collect';

const MIB = GROWTH_BYTES;

function rig(heap: HeapSize = { used: 20 * MIB, physical: 40 * MIB }) {
  const queued: (() => void)[] = [];
  const lines: string[] = [];
  const live = { quiet: true }; // the process's live state, which its caller may not have told yet
  const collect = vi.fn(() => void Object.assign(heap, { used: 5 * MIB, physical: 10 * MIB }));
  const collector = idleCollector({ log: (line) => lines.push(line), collect, heap: () => ({ ...heap }), defer: (run) => queued.push(run), now: () => 0, quiet: () => live.quiet });
  const turn = () => queued.splice(0).forEach((run) => run());
  return { heap, collector, collect, lines, turn, queued, live };
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

  it('asks the process again as it collects: work begun and not yet told holds it off until a reading finds it quiet', () => {
    const { collector, collect, turn, live } = rig();
    collector.set(true);
    live.quiet = false; // a send's queue is busy; its status is told once its save settles
    turn();
    expect(collect).not.toHaveBeenCalled();
    live.quiet = true;
    collector.set(true); // its caller's next reading: an entry, though the last thing told was quiet too
    turn();
    expect(collect).toHaveBeenCalledOnce();
  });

  it('keeps a dropped holding owed through a collection that finds the process busy', () => {
    const { collector, collect, turn, live } = rig();
    collector.set(true);
    turn();
    collector.dropped();
    live.quiet = false;
    turn();
    expect(collect).toHaveBeenCalledOnce();
    live.quiet = true;
    collector.set(true);
    turn(); // the heap reads as the last collection left it: only the owed holding collects
    expect(collect).toHaveBeenCalledTimes(2);
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

  it('collects a dropped holding at the next idle entry when it was busy before the deferred turn', () => {
    const { collector, collect, turn } = rig();
    collector.set(true);
    turn();
    collector.dropped();
    collector.set(false);
    turn();
    expect(collect).toHaveBeenCalledOnce();
    collector.set(true);
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
    const collector = idleCollector({ log: (line) => lines.push(line), collect, heap: () => ({ used: 0, physical: 0 }), defer: (run) => queued.push(run), quiet: () => true });
    collector.set(true);
    queued.splice(0).forEach((run) => run());
    collector.set(false);
    collector.set(true);
    queued.splice(0).forEach((run) => run());
    expect(collect).toHaveBeenCalledTimes(2);
    expect(lines[0]).toBe('idle: the collection failed: no extension');
  });
});

// A process whose idle predicate stays false (clients connected), with a clock of its own and the timers it armed.
function quietRig() {
  const heap: HeapSize = { used: 20 * MIB, physical: 40 * MIB };
  const queued: (() => void)[] = [];
  const lines: string[] = [];
  const live = { settled: true, quiet: false, io: false };
  let clock = 0;
  const timers: { at: number; run: () => void; cleared: boolean }[] = [];
  const collect = vi.fn(() => void Object.assign(heap, { used: 5 * MIB, physical: 10 * MIB }));
  const collector = idleCollector({
    log: (line) => lines.push(line), collect, heap: () => ({ ...heap }), defer: (run) => queued.push(run), now: () => clock, quiet: () => live.quiet,
    activity: { settled: () => live.settled },
    io: () => live.io,
    timer: (run, ms) => {
      const timer = { at: clock + ms, run, cleared: false };
      timers.push(timer);
      return () => void (timer.cleared = true);
    },
  });
  const armed = () => timers.filter((t) => !t.cleared && t.at >= 0).length;
  // time passes: every timer due by then fires in order, and each turn after it runs
  const advance = (ms: number) => {
    const until = clock + ms;
    for (;;) {
      const due = timers.filter((t) => !t.cleared && t.at >= 0 && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      clock = due.at;
      due.at = -1; // fired
      due.run();
      queued.splice(0).forEach((run) => run());
    }
    clock = until;
  };
  const turn = () => queued.splice(0).forEach((run) => run());
  return { heap, collector, collect, lines, live, advance, armed, turn };
}

describe('the quiet entry (Decision Log 273)', () => {
  it('collects once a quiet period passes with no activity while the process is not idle, and says so', () => {
    const { collector, collect, lines, advance } = quietRig();
    collector.set(false); // clients connected
    collector.activity();
    advance(ACTIVITY_QUIET_MS - 1);
    expect(collect).not.toHaveBeenCalled();
    advance(1);
    expect(collect).toHaveBeenCalledOnce();
    expect(lines).toEqual([`idle: collected in 0 ms, heap 40.0 to 10.0 MiB (used 20.0 to 5.0), after ${ACTIVITY_QUIET_MS / 1000} s with no activity`]);
  });

  it('waits out activity: each one starts the quiet period again', () => {
    const { collector, collect, advance } = quietRig();
    collector.activity();
    advance(20_000);
    collector.activity();
    advance(20_000); // the first activity's period has run out, the second's has not
    expect(collect).not.toHaveBeenCalled();
    advance(ACTIVITY_QUIET_MS - 20_000);
    expect(collect).toHaveBeenCalledOnce();
  });

  it('never collects on work: a period that runs out while something is in flight collects nothing, and the work’s end arms the next', () => {
    const { collector, collect, live, advance, armed } = quietRig();
    collector.activity();
    live.settled = false; // a command still unanswered
    advance(ACTIVITY_QUIET_MS);
    expect(collect).not.toHaveBeenCalled();
    expect(armed()).toBe(0);
    live.settled = true;
    collector.activity(); // its answer
    advance(ACTIVITY_QUIET_MS);
    expect(collect).toHaveBeenCalledOnce();
  });

  it('never collects on work told between the period’s end and the collection’s turn', () => {
    const heap: HeapSize = { used: 20 * MIB, physical: 40 * MIB };
    const queued: (() => void)[] = [];
    let fire: (() => void) | null = null;
    let clock = 0;
    const collect = vi.fn();
    const collector = idleCollector({ log: () => {}, collect, heap: () => ({ ...heap }), defer: (run) => queued.push(run), now: () => clock, quiet: () => false, activity: { settled: () => true }, timer: (run) => ((fire = run), () => {}) });
    collector.activity();
    clock = ACTIVITY_QUIET_MS;
    fire!();
    collector.activity(); // a request arrived before the loop turned
    queued.splice(0).forEach((run) => run());
    expect(collect).not.toHaveBeenCalled();
  });

  it('collects at most once per quiet period: with no activity after it, its clock is never armed again', () => {
    const { heap, collector, collect, advance, armed } = quietRig();
    collector.activity();
    advance(ACTIVITY_QUIET_MS);
    expect(collect).toHaveBeenCalledOnce();
    expect(armed()).toBe(0);
    heap.used += 10 * MIB; // grown, but nothing happened to end a period
    advance(10 * ACTIVITY_QUIET_MS);
    expect(collect).toHaveBeenCalledOnce();
    expect(armed()).toBe(0);
  });

  it('re-arms only at activity, and the guard skips a period that finds nothing grown: a client idling repeatedly costs nothing after the first', () => {
    const { heap, collector, collect, advance } = quietRig();
    collector.activity();
    advance(ACTIVITY_QUIET_MS);
    expect(collect).toHaveBeenCalledOnce();
    collector.activity(); // the client's next request
    heap.used += MIB - 1;
    heap.physical += MIB - 1;
    advance(ACTIVITY_QUIET_MS);
    expect(collect).toHaveBeenCalledOnce();
    collector.activity(); // and one whose work grew the heap
    heap.used += 1;
    advance(ACTIVITY_QUIET_MS);
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('shares the guard with the idle entry: the one that comes second finds nothing grown', () => {
    const { collector, collect, live, advance, turn } = quietRig();
    collector.activity();
    advance(ACTIVITY_QUIET_MS);
    expect(collect).toHaveBeenCalledOnce();
    live.quiet = true;
    collector.set(true); // the last client left, its departure no work: an idle entry, weighed against the quiet entry's floor
    turn();
    expect(collect).toHaveBeenCalledOnce();
  });

  it('never collects while a work lifetime is open, however long; its end arms the next period', () => {
    const { collector, collect, advance, armed } = quietRig();
    const end = collector.work(); // a response body still streaming after its request was answered
    advance(10 * ACTIVITY_QUIET_MS);
    expect(collect).not.toHaveBeenCalled();
    expect(armed()).toBe(0);
    end();
    end(); // a second end does nothing
    advance(ACTIVITY_QUIET_MS - 1);
    expect(collect).not.toHaveBeenCalled();
    advance(1);
    expect(collect).toHaveBeenCalledOnce();
  });

  it('counts each open lifetime: one still open holds it off', () => {
    const { collector, collect, advance } = quietRig();
    const first = collector.work();
    const second = collector.work();
    first();
    advance(2 * ACTIVITY_QUIET_MS);
    expect(collect).not.toHaveBeenCalled();
    second();
    advance(ACTIVITY_QUIET_MS);
    expect(collect).toHaveBeenCalledOnce();
  });

  it('never collects over the process’s own I/O in flight: asked again shortly, a bounded number of times', () => {
    const { collector, collect, live, advance, armed } = quietRig();
    collector.activity();
    live.io = true; // a periodic reconcile's read, told to no one
    advance(ACTIVITY_QUIET_MS);
    expect(collect).not.toHaveBeenCalled();
    expect(armed()).toBe(1);
    live.io = false;
    advance(IO_RETRY_MS);
    expect(collect).toHaveBeenCalledOnce();
  });

  it('gives a period up when its I/O never settles, so a stuck write is no clock', () => {
    const { collector, collect, live, advance, armed } = quietRig();
    collector.activity();
    live.io = true;
    advance(ACTIVITY_QUIET_MS + IO_RETRIES * IO_RETRY_MS);
    expect(armed()).toBe(0);
    live.io = false;
    advance(10 * ACTIVITY_QUIET_MS);
    expect(collect).not.toHaveBeenCalled();
    collector.activity(); // the next period asks again
    advance(ACTIVITY_QUIET_MS);
    expect(collect).toHaveBeenCalledOnce();
  });

  it('reads in-flight I/O from the process’s active resources: requests, never its standing handles', () => {
    expect(ioInFlight(['TCPServerWrap', 'TCPSocketWrap', 'PipeWrap', 'Timeout', 'Immediate', 'ProcessWrap', 'FSEventWrap', 'TTYWrap'])).toBe(false);
    for (const request of ['FSReqCallback', 'FSReqPromise', 'FileHandleCloseReq', 'WriteWrap', 'SimpleWriteWrap', 'ShutdownWrap', 'GetAddrInfoReqWrap']) expect(ioInFlight(['TCPSocketWrap', request]), request).toBe(true);
    expect(typeof ioInFlight()).toBe('boolean'); // this process's own
  });

  it('does nothing for a process that did not opt in, and nothing once stopped', () => {
    const queued: (() => void)[] = [];
    const timer = vi.fn(() => () => {});
    const collect = vi.fn();
    const plain = idleCollector({ log: () => {}, collect, heap: () => ({ used: 0, physical: 0 }), defer: (run) => queued.push(run), quiet: () => false, timer });
    plain.activity();
    expect(timer).not.toHaveBeenCalled();
    const { collector, collect: quietCollect, advance, armed } = quietRig();
    collector.activity();
    collector.stop();
    expect(armed()).toBe(0);
    collector.activity();
    advance(ACTIVITY_QUIET_MS);
    expect(quietCollect).not.toHaveBeenCalled();
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
