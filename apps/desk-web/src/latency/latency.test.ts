// The latency instrument (desk ticket #57): its ring and its percentiles, the readout's switch, a frame's batch, the raw
// samples a measurement run reads, an RPC's time, and the hops one transcript records into it — its first rows, a
// chunk's stamp, a resume's gap, an older page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranscriptStore } from '../../../../src/renderer/src/stores/transcript';
import { Chain, SESSION } from '../../test/double/chain-rows';
import { FakePlane, mount, settle } from '../../test/double/fake-plane';
import { readRecording, rowsBefore, scriptOf } from '../../test/double/session-stream';
import { DeskTranscript } from '../depth/source/desk-transcript';
import { latency, LatencyRecorder, LOG, PENDING, percentile, RING, type LatencyPath } from './latency';

afterEach(() => vi.useRealTimers());

describe('the recorder', () => {
  it('takes percentiles by nearest rank', () => {
    const sorted = Float64Array.from({ length: 20 }, (_, i) => i + 1); // 1 … 20
    expect(percentile(sorted, 50)).toBe(10);
    expect(percentile(sorted, 95)).toBe(19);
    expect(percentile(sorted, 100)).toBe(20);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNaN();
  });

  it('keeps each path’s last samples, and reports n, p50, p95 and max over them', () => {
    const recorder = new LatencyRecorder(() => {});
    for (let i = 1; i <= RING + 50; i++) recorder.record('owner.ack', i); // the first 50 fall out of the ring
    recorder.record('stream.chunk', Number.NaN); // a stamp absent or unparseable is no sample
    const { paths } = recorder.report();
    expect(paths['owner.ack']).toMatchObject({ n: RING, p50: 150, p95: 240, max: 250 });
    expect(paths['stream.chunk']).toBeUndefined();
  });

  it('logs each sample and tells the overlay only while the readout is on', () => {
    const lines: string[] = [];
    const recorder = new LatencyRecorder((line) => lines.push(line));
    const told = vi.fn();
    recorder.subscribe(told);
    recorder.record('view.snapshot', 12.4);
    expect(lines).toEqual([]);
    expect(told).not.toHaveBeenCalled();
    recorder.on = true;
    recorder.record('view.snapshot', 12.6);
    recorder.count('socket.reconnects');
    expect(lines).toEqual(['[desk latency] view.snapshot 13']);
    expect(told).toHaveBeenCalledTimes(2);
    expect(recorder.report()).toMatchObject({ on: true, paths: { 'view.snapshot': { n: 2 } }, counts: { 'socket.reconnects': 1 } });
  });

  it('times what waits to be drawn at the next frame, every sample of a frame in one callback', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date', 'performance'] }); // no animation frames under Node: the next task stands for one
    const recorder = new LatencyRecorder(() => {});
    recorder.drawn('request.drawn', performance.now() - 20);
    recorder.drawn('stream.row', Date.now() - 300, true);
    expect(vi.getTimerCount()).toBe(1);
    expect(recorder.report().paths).toEqual({});
    vi.runAllTimers();
    const { paths } = recorder.report();
    expect(paths['request.drawn']).toMatchObject({ n: 1, max: 20 });
    expect(paths['stream.row']).toMatchObject({ n: 1, max: 300 });
  });

  it('queues at most PENDING samples for one frame, and none while the page is hidden', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date', 'performance'] });
    const lines: string[] = [];
    const recorder = new LatencyRecorder((line) => lines.push(line));
    recorder.on = true;
    for (let i = 0; i < PENDING + 10; i++) recorder.drawn('stream.chunk', Date.now(), true); // frames suspended, chunks still coming
    vi.runAllTimers();
    expect(lines).toHaveLength(PENDING);

    lines.length = 0;
    vi.stubGlobal('document', { visibilityState: 'hidden' }); // a background tab: nothing is drawn
    try {
      recorder.drawn('stream.row', Date.now(), true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
    vi.runAllTimers();
    expect(lines).toEqual([]);
  });

  it('measures an owner’s send to its acknowledgement, its delivery, and its row, each once', () => {
    const recorder = new LatencyRecorder(() => {});
    recorder.humanSent('n1', false);
    recorder.delivery({ writer: 'hub/m1', seq: 4 }, 'delivered'); // before the ack names its event: not this send's
    recorder.humanAcked('n1', { writer: 'hub/m1', seq: 4 });
    recorder.delivery({ writer: 'hub/m1', seq: 4 }, 'recorded');
    recorder.delivery({ writer: 'hub/m1', seq: 4 }, 'delivered');
    recorder.delivery({ writer: 'hub/m1', seq: 4 }, 'delivered'); // a second recipient's
    recorder.ownerRow((ref) => ref.writer === 'hub/m1' && ref.seq === 4 && !ref.wake, new Date(Date.now() + 5).toISOString());
    recorder.ownerRow(() => true, new Date().toISOString()); // measured already: forgotten
    const { paths } = recorder.report();
    expect(paths['owner.ack']?.n).toBe(1);
    expect(paths['owner.delivered']?.n).toBe(1);
    expect(paths['owner.row']?.n).toBe(1);
    expect(recorder.samples().map((s) => [s.path, s.ref])).toEqual([
      ['owner.ack', 'n1'],
      ['owner.delivered', 'n1'],
      ['owner.row', 'n1'],
    ]);
  });

  it('keeps the last LOG samples raw, each with when it was taken and its ref, for a script to read from a time on', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date', 'performance'] });
    const recorder = new LatencyRecorder(() => {});
    vi.setSystemTime(1_000);
    recorder.record('owner.ack', 12, 'n1');
    vi.setSystemTime(2_000);
    recorder.record('view.snapshot', 30);
    recorder.drawn('request.drawn', performance.now() - 5, false, 'req-1');
    vi.runAllTimers();
    expect(recorder.samples()).toEqual([
      { path: 'owner.ack', ms: 12, at: 1_000, ref: 'n1' },
      { path: 'view.snapshot', ms: 30, at: 2_000 },
      { path: 'request.drawn', ms: 5, at: 2_000, ref: 'req-1' },
    ]);
    expect(recorder.samples(1_000).map((s) => s.path)).toEqual(['view.snapshot', 'request.drawn']);
    for (let i = 0; i < LOG + 5; i++) recorder.record('stream.chunk', i);
    const kept = recorder.samples();
    expect(kept).toHaveLength(LOG);
    expect([kept[0].ms, kept.at(-1)!.ms]).toEqual([5, LOG + 4]);
  });

  it('times an RPC whose name has a path from its sending until its result, once, and not one that failed', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date', 'performance'] });
    const recorder = new LatencyRecorder(() => {});
    recorder.rpcSent('r1', 'interrupt');
    recorder.rpcSent('r2', 'decide');
    recorder.rpcSent('r3', 'model'); // no path for it: not timed
    vi.advanceTimersByTime(40);
    recorder.rpcSent('r1', 'interrupt'); // a retry keeps the first send's time
    recorder.rpcState('r1', 'forwarded');
    vi.advanceTimersByTime(10);
    recorder.rpcState('r1', 'done');
    recorder.rpcState('r1', 'done');
    recorder.rpcState('r2', 'failed');
    recorder.rpcState('r3', 'done');
    const { paths } = recorder.report();
    expect(paths['rpc.interrupt']).toMatchObject({ n: 1, max: 50 });
    expect(paths['rpc.decide']).toBeUndefined();
    expect(recorder.samples().map((s) => s.ref)).toEqual(['r1']);
  });

  it('times a command from its RPC to queued, to its op end (a mid-turn one kept apart), and to its readback drawn, each once', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date', 'performance'] });
    const recorder = new LatencyRecorder(() => {});
    recorder.commandSent('idle', false);
    recorder.commandSent('busy', true);
    vi.advanceTimersByTime(40);
    recorder.commandQueued('idle');
    recorder.commandQueued('idle'); // the same answer again (a retry answered from the record): once
    recorder.commandQueued('busy');
    vi.advanceTimersByTime(60);
    recorder.commandEnded('idle');
    recorder.commandDrawn('idle');
    vi.advanceTimersByTime(900);
    recorder.commandEnded('busy');
    recorder.commandEnded('busy'); // ended already: once
    recorder.commandDrawn('busy');
    recorder.commandDrawn('busy'); // drawn again (a re-render): once
    recorder.commandEnded('elsewhere'); // a command another tab or the CLI sent: not this tab's to time
    recorder.commandDrawn('elsewhere');
    vi.runAllTimers();
    const { paths } = recorder.report();
    expect(paths['op.queued']).toMatchObject({ n: 2, max: 40 });
    expect(paths['op.ran']).toMatchObject({ n: 1, max: 100 });
    expect(paths['op.ran.busy']).toMatchObject({ n: 1, max: 1000 });
    expect(paths['op.readback']).toMatchObject({ n: 2, max: 1000 });
  });

  it("times queued when the op's end came in before the RPC's result, and never twice", () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date', 'performance'] });
    const recorder = new LatencyRecorder(() => {});
    recorder.commandSent('n1', false);
    vi.advanceTimersByTime(30);
    recorder.commandEnded('n1'); // the session-wide op end outran the rpc-state
    recorder.commandDrawn('n1');
    vi.advanceTimersByTime(20);
    recorder.commandQueued('n1');
    recorder.commandQueued('n1');
    vi.runAllTimers();
    const { paths } = recorder.report();
    expect(paths['op.ran']).toMatchObject({ n: 1, max: 30 });
    expect(paths['op.queued']).toMatchObject({ n: 1, max: 50 });
    expect(paths['op.readback']).toMatchObject({ n: 1 });
  });

  it('takes no readback sample for an outcome that was never drawn (a later command took the status line)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date', 'performance'] });
    const recorder = new LatencyRecorder(() => {});
    recorder.commandSent('first', false);
    recorder.commandSent('second', false);
    recorder.commandQueued('first');
    recorder.commandEnded('first'); // its status line was replaced by the second's: not drawn
    recorder.commandQueued('second');
    recorder.commandEnded('second');
    recorder.commandDrawn('second');
    vi.runAllTimers();
    const { paths } = recorder.report();
    expect(paths['op.ran']).toMatchObject({ n: 2 });
    expect(paths['op.readback']).toMatchObject({ n: 1 });
  });

  it("times a read by its kind's path, and keeps none for a kind it has no path for", () => {
    const recorder = new LatencyRecorder(() => {});
    recorder.readAnswered('status', 35);
    recorder.readAnswered('usage', 50);
    expect(recorder.report().paths).toEqual({ 'read.status': expect.objectContaining({ n: 1, max: 35 }) });
  });
});

describe('one transcript’s hops', () => {
  const script = scriptOf(readRecording().session, null);
  const samples = (path: LatencyPath) => latency.report().paths[path]?.n ?? 0;

  it('times its first rows, a chunk from its stamp, and a resume from its disruption', async () => {
    const plane = new FakePlane('proj');
    const store = createTranscriptStore();
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: 'sess-1', agentId: null }, store });
    const before = { snapshot: samples('view.snapshot'), first: samples('view.first-rows'), chunk: samples('stream.chunk'), gap: samples('resume.gap'), resumes: latency.report().counts['subscription.resumes'] ?? 0 };
    controller.open();
    const unmount = mount(controller, store);
    const held = script.findLastIndex((item) => item.kind === 'row') + 1;
    plane.snapshot(script, held);
    expect(samples('view.snapshot')).toBe(before.snapshot + 1);
    await settle();
    await settle();
    expect(samples('view.first-rows')).toBe(before.first + 1);

    plane.send('chunk', { turnId: 't9', agentId: null, step: 0, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'Hi' }, t: Date.now() - 40 } as never);
    plane.send('chunk', { turnId: 't9', agentId: null, step: 0, chunkIndex: 1, chunk: { kind: 'text', index: 0, text: ' there' } }); // no stamp: nothing
    await settle();
    expect(samples('stream.chunk')).toBe(before.chunk + 1);
    expect(latency.report().paths['stream.chunk']!.max).toBeGreaterThanOrEqual(40);

    plane.current.listener.interrupted();
    plane.snapshot(script, held);
    expect(samples('resume.gap')).toBe(before.gap + 1);
    expect(latency.report().counts['subscription.resumes']).toBe(before.resumes + 1);
    unmount();
    controller.close();
  });

  it('times a live row from its stamp only once its events reach the store: a progress row or a row off the chain gives no sample', async () => {
    const plane = new FakePlane('proj');
    const store = createTranscriptStore();
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: SESSION, agentId: null }, store });
    controller.open();
    const unmount = mount(controller, store);
    const c = new Chain();
    c.prompt('Name a colour.');
    c.answer('Red.');
    plane.send('snapshot', { rows: [...c.rows].reverse(), more: false, subagents: [], presence: { record: { status: 'busy' }, bridge: true } as never, streaming: [], offChain: [] });
    await settle();
    await settle();
    const before = samples('stream.row');
    const progress = c.row('progress', { data: { type: 'hook_progress', hookEvent: 'Stop', hookName: 'Stop', command: 'notify' }, parentToolUseID: 'toolu_h1', toolUseID: 'toolu_h1' });
    plane.send('row', { row: progress, agentId: null });
    const dropped = c.answer('Blue, or');
    plane.send('row', { row: dropped, agentId: null, offChain: [dropped.uuid as string] });
    await settle();
    expect(samples('stream.row')).toBe(before);
    plane.send('row', { row: c.answer('Blue.', progress), agentId: null });
    await settle();
    expect(samples('stream.row')).toBe(before + 1);
    unmount();
    controller.close();
  });

  it('times an older page from its asking until its rows are in', async () => {
    const plane = new FakePlane('proj');
    const store = createTranscriptStore();
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: 'sess-1', agentId: null }, store, page: 3 });
    controller.open();
    const unmount = mount(controller, store);
    const held = script.findLastIndex((item) => item.kind === 'row') + 1;
    plane.current.snapshot(script, held, 3);
    await settle();
    const before = samples('view.older-page');
    controller.loadOlder();
    const asked = plane.current.asked.at(-1)!;
    plane.send('rows', rowsBefore(script, held, asked.before, asked.limit));
    expect(samples('view.older-page')).toBe(before + 1);
    expect(latency.samples().at(-1)).toMatchObject({ path: 'view.older-page', ref: 'sub' }); // the fake plane's subscription id
    unmount();
    controller.close();
  });
});
