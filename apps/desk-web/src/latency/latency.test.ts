// The latency instrument (desk ticket #57): its ring and its percentiles, the readout's switch, a frame's batch, and the
// hops one transcript records into it — its first rows, a chunk's stamp, a resume's gap.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranscriptStore } from '../../../../src/renderer/src/stores/transcript';
import { Chain, SESSION } from '../../test/double/chain-rows';
import { FakePlane, mount, settle } from '../../test/double/fake-plane';
import { readRecording, scriptOf } from '../../test/double/session-stream';
import { DeskTranscript } from '../depth/source/desk-transcript';
import { latency, LatencyRecorder, PENDING, percentile, RING, type LatencyPath } from './latency';

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
});
