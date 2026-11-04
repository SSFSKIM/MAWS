// P5 O7 M8 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M8 *Operations and panel events*): a `panels`
// stream's notices at their two boundaries, against a scripted engine host: they never grow the reader's unsent stream
// past the backlog bound (the stream ends `behind`, and the device asks `session.operations` for what it missed), and a
// side log read for one launch is never published under another. The parts themselves are proved end to end at the
// endpoint (test/endpoint/subscriptions-b.test.ts).
import { describe, expect, it, vi } from 'vitest';
import { BACKLOG_BYTES, SessionStreams, type StreamRead, type StreamSink } from './stream-catchup';

const APP = 'app-1';
const operation = (opId: string, command = 'session.reloadPlugins') => ({ appSessionId: APP, opId, command, late: false, outcome: { ok: true, value: null } });

function scripted(options: { side?: 'held' } = {}) {
  let launch = 'launch-1';
  const snaps: Array<{ epoch: string; values: Record<string, unknown>; kind: string }> = [];
  const ends: string[] = [];
  let backlog = 0;
  const sides: Array<(answer: { ok: true; value: unknown }) => void> = [];
  const held: Array<() => void> = [];
  let holdQueue = false;
  const sink: StreamSink = {
    get ended() {
      return ends.length > 0;
    },
    get backlog() {
      return backlog;
    },
    subbed() {},
    snap(at, values, kind) {
      snaps.push({ epoch: at.epoch, values, kind });
    },
    ev() {},
    paused() {},
    resumed() {},
    end(reason) {
      ends.push(reason);
    },
  };
  const read: StreamRead = async (name) => {
    if (name === 'session.status') return { ok: true, value: { appSessionId: APP, launchId: launch, engineSessionId: 'eng-1', taskListId: 'eng-1' } };
    if (name === 'session.events') return { ok: true, value: { events: [], lastSeq: 0, complete: true } };
    if (name === 'side.question.list' && options.side === 'held') return new Promise((resolve) => sides.push(resolve));
    if (name === 'session.queue.list' && holdQueue) await new Promise<void>((resolve) => held.push(resolve));
    return { ok: true, value: name === 'session.pendingItems' ? { items: [] } : {} };
  };
  const streams = new SessionStreams({ available: true, panels: true, log() {}, read });
  return {
    streams,
    snaps,
    ends,
    sides,
    open: () => streams.openStream({ app: APP, cursor: null, view: 'full', from: 'start' }, sink),
    backlog: (bytes: number) => void (backlog = bytes),
    launch: (id: string) => void (launch = id),
    holdQueue: () => void (holdQueue = true),
    releaseQueue: () => {
      holdQueue = false;
      for (const go of held.splice(0)) go();
    },
  };
}

describe('a panels stream’s notices and the backlog bound', () => {
  it('ends `behind` rather than queue a notice past the bound, and queues nothing more', async () => {
    const s = scripted();
    s.open();
    await vi.waitFor(() => expect(s.snaps).toHaveLength(1));
    s.backlog(BACKLOG_BYTES + 1);
    s.streams.liveEvent('session.operation', operation('op-1'));
    s.streams.liveEvent('fs.workflowChanged', { appSessionId: APP, runId: 'run-1' });
    expect(s.ends).toEqual(['behind']);
    expect(s.snaps).toHaveLength(1);
  });

  it('ends `behind` when the notices held through an opening pass the bound, and sends none of them', async () => {
    const s = scripted();
    s.holdQueue();
    s.open();
    const big = 'x'.repeat(64 * 1024);
    for (let i = 0; i < Math.ceil(BACKLOG_BYTES / (64 * 1024)) + 1; i++) s.streams.liveEvent('session.operation', { ...operation(`op-${i}`), outcome: { ok: true, value: { title: big } } });
    expect(s.ends).toEqual(['behind']);
    s.releaseQueue();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(s.snaps).toEqual([]);
  });

  it('sends the notices held through an opening under the bound, after its state', async () => {
    const s = scripted();
    s.holdQueue();
    s.open();
    s.streams.liveEvent('session.operation', operation('op-1'));
    s.releaseQueue();
    await vi.waitFor(() => expect(s.snaps).toHaveLength(2));
    expect(s.snaps.map((x) => x.kind)).toEqual(['state', 'operation:op-1']);
    expect(s.ends).toEqual([]);
  });
});

describe('a panels stream’s side log read', () => {
  it('never publishes a read made for one launch under the next', async () => {
    const s = scripted({ side: 'held' });
    s.open();
    await vi.waitFor(() => expect(s.snaps).toHaveLength(1));
    s.streams.liveEvent('session.operation', operation('op-side', 'session.sideQuestion'));
    await vi.waitFor(() => expect(s.sides).toHaveLength(1));
    s.launch('launch-2');
    s.streams.liveEvent('session.status', { appSessionId: APP, status: { appSessionId: APP, launchId: 'launch-2', engineSessionId: 'eng-1', taskListId: 'eng-1' } });
    await vi.waitFor(() => expect(s.snaps.some((x) => x.epoch === 'launch-2' && x.kind === 'state')).toBe(true));
    s.sides[0]({ ok: true, value: { exchanges: [{ id: 'old-exchange' }] } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(s.snaps.filter((x) => 'side' in x.values)).toEqual([]);
  });

  it('publishes a read whose launch still stands', async () => {
    const s = scripted({ side: 'held' });
    s.open();
    await vi.waitFor(() => expect(s.snaps).toHaveLength(1));
    s.streams.liveEvent('session.operation', operation('op-side', 'session.sideQuestion'));
    await vi.waitFor(() => expect(s.sides).toHaveLength(1));
    s.sides[0]({ ok: true, value: { exchanges: [{ id: 'e1' }] } });
    await vi.waitFor(() => expect(s.snaps.filter((x) => 'side' in x.values)).toEqual([{ epoch: 'launch-1', values: { side: { exchanges: [{ id: 'e1' }] } }, kind: 'side' }]));
  });
});
