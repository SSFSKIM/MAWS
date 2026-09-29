// The IPC adapters (C6 M5) against a fake X2 client: `ipcSource` under the store's hydration protocol (live batches
// from `session.eventBatch`, the snapshot from `session.events`, or `fs.agentEvents` for a child), the default
// `loadSpill` over `fs.readSpill`, and the receipt's rewind interface over `session.rewindFiles`.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, EventId, ParentToolUseId, TaskId } from '@shared/graph/ids';
import type { CommandName, CommandResult, EventName, EventPayload, MawsBridge } from '@shared/ipc/schema';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { useTranscriptStore } from '../../stores/transcript';
import { rowsOf } from '../model/derive';
import { turnId } from '../model/keys';
import { applyEvents, createState } from '../model/reduce';
import type { Row } from '../model/rows';
import { builder, tool, uuid } from '../model/test-events';
import { Disclosures, NO_ACTIONS, TranscriptProvider } from '../view/context';
import { RowView } from '../view/rows/Row';
import { Transcript } from '../view/Transcript';
import { ipcLoadSpillOver, ipcRewindOver, ipcSourceOver } from './ipc';
import type { TranscriptSource } from './types';

const APP = 'app-1' as AppSessionId;
const AGENT = 'agent-7' as AgentId;

// A fake X2 client: every invoke waits for the test to answer it; events are pushed by name.
function fakeClient() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const calls: { name: string; input: unknown; answer: (result: CommandResult<CommandName>) => void; answered?: boolean }[] = [];
  const client: MawsBridge = {
    invoke: ((name: CommandName, input: unknown) => new Promise((resolve) => calls.push({ name, input, answer: resolve as never }))) as MawsBridge['invoke'],
    on: ((name: EventName, listener: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    }) as MawsBridge['on'],
    pathForFile: () => '', // C7: MawsBridge gained pathForFile
  };
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => {
    for (const listener of listeners.get(name) ?? []) listener(payload);
  };
  return { client, calls, emit, listeners };
}

const batch = (events: SessionEvent[], appSessionId = APP) => ({ appSessionId, events });

// A session source subscribed and past an empty snapshot, as the store drives it (batches before the snapshot are held).
async function subscribed(fake: ReturnType<typeof fakeClient>, source: TranscriptSource, listener: (events: SessionEvent[]) => void) {
  source.subscribe(listener);
  const snapshot = source.snapshot();
  fake.calls.at(-1)!.answer({ ok: true, value: { events: [], lastSeq: 0, complete: true } } as never);
  await snapshot;
}

afterEach(() => {
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
});

describe('ipcSource', () => {
  // Three turns; disk-derived events carry `seq: null`, so the overlap is recognised by id alone.
  function history() {
    const b = builder();
    for (const n of [1, 2, 3, 4]) {
      b.turn(`u${n}`);
      b.text(`m${n}`, 0, `Answer ${n}`);
      b.end([`u${n}`]);
    }
    return b.events.map((event, i) => (i < 6 ? { ...event, seq: null } : event));
  }

  // Whole-branch review: the last holder detached, the process exited unobserved, and the next attach's snapshot is the
  // same history in the other id form (disk uuids for live ids). The key starts over instead of applying it twice.
  it('an attach that starts a session key over resets its state: a snapshot in the other id form applies once', async () => {
    const liveForm = history().map((event, i) => ({ ...event, id: `live:${i}` as EventId, seq: i }));
    const diskForm = history().map((event, i) => ({ ...event, id: `disk:${i}` as EventId, seq: null }));
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const source = ipcSourceOver(fake.client, APP);
    const first = store.attach(source.key!, source);
    fake.calls[0].answer({ ok: true, value: { events: liveForm, lastSeq: liveForm.length - 1, complete: true } } as never);
    await first;
    store.detach(source.key!); // the tab goes away; the entry stays
    const again = store.attach(source.key!, source);
    fake.calls[1].answer({ ok: true, value: { events: diskForm, lastSeq: -1, complete: true } } as never);
    await again;
    const entry = useTranscriptStore.getState().entries[source.key!];
    expect(entry.state.order).toHaveLength(4); // no phantom turns
    expect([...entry.state.seen]).toEqual(diskForm.map((event) => event.id));
    expect(entry.rows).toEqual(rowsOf(applyEvents(createState(null, null), diskForm)));
    store.detach(source.key!);
  });

  it('hydrates through the store: buffered before the snapshot, overlap dropped by id, order kept through the drain, then live', async () => {
    const all = history();
    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, APP);
    expect(source.key).toBe(APP);
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(source.key!, source);

    // Subscribed first; the snapshot is one `session.events` call.
    expect(fake.listeners.get('session.eventBatch')?.size).toBe(1);
    expect(fake.calls.map((call) => [call.name, call.input])).toEqual([['session.events', { appSessionId: APP, afterSeq: null, limit: null }]]);

    fake.emit('session.eventBatch', batch(all.slice(2, 4))); // before the snapshot: buffered; the snapshot carries both
    fake.emit('session.eventBatch', batch([...all.slice(4, 6), ...all.slice(6, 8)])); // half overlaps the snapshot's seq-null tail
    fake.emit('session.eventBatch', batch(all.slice(0, 12), 'app-other' as AppSessionId)); // another session: ignored
    expect(useTranscriptStore.getState().entries[APP].phase).toBe('hydrating');
    expect(rowsOf(useTranscriptStore.getState().entries[APP].state)).toEqual([]);

    // A batch delivered while the buffer drains joins its tail, in order.
    let pushedDuringDrain = false;
    const unsubscribe = useTranscriptStore.subscribe((state) => {
      if (pushedDuringDrain || !state.entries[APP]?.state.seen.has(all[6].id)) return;
      pushedDuringDrain = true;
      fake.emit('session.eventBatch', batch(all.slice(8, 9)));
    });
    fake.calls[0].answer({ ok: true, value: { events: all.slice(0, 6), lastSeq: 5, complete: true } });
    await hydrated;
    unsubscribe();
    expect(pushedDuringDrain).toBe(true);
    expect(useTranscriptStore.getState().entries[APP].phase).toBe('live');

    fake.emit('session.eventBatch', batch(all.slice(7))); // live, overlapping what the drain applied
    const state = useTranscriptStore.getState().entries[APP].state;
    expect([...state.seen]).toEqual(all.map((event) => event.id));
    expect(useTranscriptStore.getState().rows(APP)).toEqual(rowsOf(applyEvents(createState(null, null), all)));
  });

  // A resumed session: a read before the launch started C4's disk follower, which keeps delivering the new launch's
  // events in disk form beside the live journal's. Each reply renders once, from the live form; the disk history before
  // the launch and an event the app synthesises (seq null, under the app session id) still pass.
  it('prefers the live form when a disk follower delivers the same events after a resume', async () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Before the resume.');
    b.end(['u1']);
    const history = b.events.map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null }));
    const r = builder('2026-09-28T11:00:00.000Z');
    r.turn('u2');
    r.text('m2', 0, 'After the resume.');
    r.end(['u2']);
    const liveForm = r.events.map((event, i) => ({ ...event, id: `${APP}:launch-2:${i + 1}:0` as EventId, seq: i + 1 }));
    const diskForm = r.events.map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null }));
    const notice = { ...r.emit('notice.posted', { level: 'warning', key: 'relay:direct_fallback', text: 'Direct route.' }), id: `${APP}:c10:relay-fallback:1` as EventId, seq: null };

    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, APP);
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(source.key!, source);
    fake.calls[0].answer({ ok: true, value: { events: history, lastSeq: 0, complete: true } } as never);
    await hydrated;
    fake.emit('session.eventBatch', batch(liveForm.slice(0, 2)));
    fake.emit('session.eventBatch', batch([...diskForm.slice(0, 2), notice])); // the follower's copy, and the app's notice
    fake.emit('session.eventBatch', batch([...diskForm.slice(2), ...liveForm.slice(2)])); // the copy first within a batch
    const entry = useTranscriptStore.getState().entries[APP];
    expect([...entry.state.seen]).toEqual([...history, ...liveForm.slice(0, 2), notice, ...liveForm.slice(2)].map((event) => event.id));
    const texts = entry.rows.filter((row) => row.kind === 'assistant_text');
    expect(texts).toHaveLength(2); // one reply before the resume, one after: none twice
    store.detach(source.key!);

    // The next attachment starts over: its snapshot is live (the stream's ring), so the follower's copies drop, those
    // delivered before the snapshot answered included.
    store.drop(source.key!);
    const again = store.attach(source.key!, source);
    fake.emit('session.eventBatch', batch(diskForm.slice(0, 1))); // during the round trip: held, then dropped
    fake.calls[1].answer({ ok: true, value: { events: liveForm, lastSeq: liveForm.length, complete: true } } as never);
    await again;
    fake.emit('session.eventBatch', batch(diskForm.slice(1)));
    expect([...useTranscriptStore.getState().entries[APP].state.seen]).toEqual(liveForm.map((event) => event.id));
    store.detach(source.key!);
  });

  it('keeps a followed child’s own events out of the parent; the child’s parent-side traffic still reaches it', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Agent', { description: 'Look around', prompt: 'look' });
    b.end(['u1']);
    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, APP);
    const received: EventId[][] = [];
    await subscribed(fake, source, (events) => received.push(events.map((event) => event.id)));
    const own = { ...b.events[0], id: 'own' as EventId, agentId: AGENT }; // the child's slice: top-level in its own transcript
    const traffic = { ...b.events[0], id: 'traffic' as EventId, agentId: AGENT, parentToolUseId: 't1' as ParentToolUseId };
    fake.emit('session.eventBatch', batch([b.events[0], own, traffic]));
    fake.emit('session.eventBatch', batch([own]));
    expect(received).toEqual([[b.events[0].id, 'traffic']]);
  });

  // C3 attributes a local agent's lifecycle events to the agent they concern (`agentId` = the task id) while they stay
  // top-level parent events (rebase equivalence gate, pass1/subagent seq 172): the parent keeps them.
  it('keeps the parent’s lifecycle reports on a child, which C3 tags with the child’s agent id', async () => {
    const b = builder();
    b.turn('u1');
    const started = { ...b.emit('subagent.started', { taskId: AGENT as string as TaskId, toolUseId: tool('t1'), description: 'Look', subagentType: null, isBackground: false, spawnDepth: 1, prompt: null }), agentId: AGENT };
    const progress = { ...b.emit('subagent.progress', { taskId: AGENT as string as TaskId, description: 'Look', usage: { totalTokens: 1, toolUses: 1, durationMs: 1 }, lastToolName: 'Read', summary: null }), agentId: AGENT };
    const fake = fakeClient();
    const received: EventId[][] = [];
    await subscribed(fake, ipcSourceOver(fake.client, APP), (events) => received.push(events.map((event) => event.id)));
    fake.emit('session.eventBatch', batch([b.events[0], started, progress]));
    expect(received).toEqual([[b.events[0].id, started.id, progress.id]]);
  });

  it('a failed snapshot rejects with the X2 error, and the store marks the key failed', async () => {
    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, APP);
    const hydrated = useTranscriptStore.getState().attach(APP, source);
    fake.calls[0].answer({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is not running' } });
    await hydrated;
    expect(useTranscriptStore.getState().entries[APP]).toMatchObject({ phase: 'failed', error: 'engine-host is not running' });
    expect(fake.listeners.get('session.eventBatch')?.size).toBe(0);
  });
});

// Child source provenance (C8's ask, binding): one memoised source per `appSessionId:agentId`, shared by C5's agent
// tab and C8's drill-in; live (the parent's stream and snapshot, filtered by agent) when the parent's snapshot holds
// the child, disk (fs.agentEvents) otherwise; a live child that exits switches the same source to disk with a reset.
describe('child source provenance', () => {
  const CHILD_KEY = `${APP}:${AGENT}`;
  // The child's events as the live wire carries them (agentId and the parent tool use set), and the parent's own.
  function live() {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Agent', { description: 'Look around', prompt: 'look' });
    b.emit('subagent.started', { taskId: AGENT as string as TaskId, toolUseId: tool('t1'), description: 'Look around', subagentType: null, isBackground: true, spawnDepth: 1, prompt: 'look' });
    const parent = [...b.events];
    const c = builder('2026-09-28T10:00:01.000Z');
    c.text('c1', 0, 'Looking.');
    c.toolUse('c2', 'Read', { file_path: '/p/a.ts' }, 'c2', 0);
    c.result('c2', 'contents');
    c.text('c3', 0, 'Found it.');
    const child = c.events.map((event) => ({ ...event, id: `live:${event.id}` as EventId, agentId: AGENT, parentToolUseId: 't1' as ParentToolUseId }));
    return { parent, child };
  }
  // The same child backfilled from its agent-*.jsonl: disk ids (uuids), no parent tool use.
  const onDisk = (child: SessionEvent[]) => child.map((event) => ({ ...event, id: `disk:${event.id.slice('live:'.length)}` as EventId, seq: null, parentToolUseId: null }));
  const childSource = (fake: ReturnType<typeof fakeClient>) => ipcSourceOver(fake.client, APP, AGENT);
  // The parent's report that a child ended (a top-level event of the parent's stream).
  const finish = (agentId: string, at: string, status: 'completed' | 'failed' | 'stopped') =>
    builder(at).emit('subagent.finished', { taskId: agentId as TaskId, status, summary: null, outputFile: null, reason: null }, { id: `finish:${agentId}:${status}` });
  const answer = (fake: ReturnType<typeof fakeClient>, name: string, value: unknown) => {
    const call = fake.calls.find((candidate) => candidate.name === name && !candidate.answered);
    if (!call) throw new Error(`no pending ${name}`);
    call.answered = true;
    call.answer({ ok: true, value } as never);
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const dividerOf = (key: string) => useTranscriptStore.getState().rows(key).find((row): row is Extract<Row, { kind: 'divider' }> => row.kind === 'divider')!;

  it('is memoised per key: the same source for the same app session and agent, another for another', () => {
    const fake = fakeClient();
    expect(ipcSourceOver(fake.client, APP, AGENT)).toBe(ipcSourceOver(fake.client, APP, AGENT));
    expect(ipcSourceOver(fake.client, APP)).toBe(ipcSourceOver(fake.client, APP));
    expect(ipcSourceOver(fake.client, APP, 'agent-8' as AgentId)).not.toBe(ipcSourceOver(fake.client, APP, AGENT));
    const source = childSource(fake);
    expect([source.key, source.agentId]).toEqual([CHILD_KEY, AGENT]);
  });

  it('live: the parent’s snapshot holds the child, so its events come from session.events filtered by agent, no disk follower', async () => {
    const { parent, child } = live();
    const fake = fakeClient();
    const source = childSource(fake);
    const received: EventId[][] = [];
    source.subscribe((events) => received.push(events.map((event) => event.id)));
    const snapshot = source.snapshot();
    expect(fake.calls.map((call) => [call.name, call.input])).toEqual([['session.events', { appSessionId: APP, afterSeq: null, limit: null }]]);
    answer(fake, 'session.events', { events: [...parent, ...child.slice(0, 2)], lastSeq: 9, complete: true });
    await expect(snapshot).resolves.toEqual(child.slice(0, 2));
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events']);
    fake.emit('session.eventBatch', batch([...child.slice(2), { ...child[0], id: 'other' as EventId, agentId: 'agent-8' as AgentId }, parent[0]]));
    expect(received).toEqual([child.slice(2).map((event) => event.id)]);
  });

  // C3 tags the parent's lifecycle reports on a local agent with that agent's id (rebase equivalence gate): they are
  // the parent's rows, never the child's own events; only the report that it ended joins the slice.
  it('live: the parent’s lifecycle reports tagged with the child’s agent id stay out of the child’s slice, except its end', async () => {
    const { parent, child } = live();
    const tagged = <E extends SessionEvent>(event: E): E => ({ ...event, agentId: AGENT });
    const report = builder('2026-09-28T10:00:02.000Z');
    const progress = tagged(report.emit('subagent.progress', { taskId: AGENT as string as TaskId, description: 'Look around', usage: { totalTokens: 1, toolUses: 1, durationMs: 1 }, lastToolName: 'Read', summary: null }, { id: 'progress' }));
    const finished = tagged(finish(AGENT, '2026-09-28T10:00:08.000Z', 'completed'));
    const fake = fakeClient();
    const source = childSource(fake);
    const received: EventId[][] = [];
    source.subscribe((events) => received.push(events.map((event) => event.id)));
    const snapshot = source.snapshot();
    answer(fake, 'session.events', { events: [...parent.map((event) => (event.kind === 'subagent.started' ? tagged(event) : event)), ...child.slice(0, 2)], lastSeq: 9, complete: true });
    await expect(snapshot).resolves.toEqual(child.slice(0, 2));
    fake.emit('session.eventBatch', batch([child[2], progress, finished]));
    expect(received).toEqual([[child[2].id, finished.id]]);
  });

  it('disk: a child the parent never started in its snapshot (a disk-backed parent) is read with fs.agentEvents, which starts following', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const fake = fakeClient();
    const snapshot = childSource(fake).snapshot();
    answer(fake, 'session.events', { events: parent.filter((event) => event.kind !== 'subagent.started'), lastSeq: 3, complete: true });
    await flush();
    expect(fake.calls.map((call) => [call.name, call.input])).toEqual([
      ['session.events', { appSessionId: APP, afterSeq: null, limit: null }],
      ['fs.agentEvents', { appSessionId: APP, agentId: AGENT }],
    ]);
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await expect(snapshot).resolves.toEqual(disk);
  });

  it('disk: a child that finished is read with fs.agentEvents, and the parent’s finish event joins its slice', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const finished = finish(AGENT, '2026-09-28T10:00:08.000Z', 'failed');
    const fake = fakeClient();
    const snapshot = childSource(fake).snapshot();
    answer(fake, 'session.events', { events: [...parent, ...child, finished], lastSeq: 9, complete: true });
    await flush();
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events', 'fs.agentEvents']);
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await expect(snapshot).resolves.toEqual([...disk, finished]);
  });

  it('a drill-in opened before the child’s first event follows the live stream and never reads fs.agentEvents while the child runs', async () => {
    const { parent, child } = live();
    const fake = fakeClient();
    const hydrated = useTranscriptStore.getState().attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: parent, lastSeq: 3, complete: true }); // started, no child event yet
    await hydrated;
    expect(useTranscriptStore.getState().entries[CHILD_KEY].phase).toBe('live');
    fake.emit('session.eventBatch', batch(child.slice(0, 2)));
    fake.emit('session.eventBatch', batch(child.slice(2)));
    await flush();
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events']);
    expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual(child.map((event) => event.id));
    useTranscriptStore.getState().detach(CHILD_KEY);
  });

  it('the parent’s finish event settles the child’s divider: Worked for …, through the reset to disk as before', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: [...parent, ...child], lastSeq: 9, complete: true });
    await hydrated;
    const divider = () => useTranscriptStore.getState().rows(CHILD_KEY).find((row): row is Extract<Row, { kind: 'divider' }> => row.kind === 'divider')!;
    expect(divider().state).toBe('working');
    const finished = finish(AGENT, '2026-09-28T10:00:08.000Z', 'completed');
    fake.emit('session.eventBatch', batch([finished]));
    expect(divider().state).toBe('completed'); // delivered into the slice before the reset
    await flush();
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events', 'fs.agentEvents']); // the reset still follows the batch that ended the child
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await flush();
    expect(useTranscriptStore.getState().entries[CHILD_KEY].phase).toBe('live');
    expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual([...disk, finished].map((event) => event.id));
    expect(divider().state).toBe('completed');
    const view = render(
      <TranscriptProvider value={{ storeKey: CHILD_KEY, variant: 'child', actions: NO_ACTIONS, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 't' }}>
        <RowView row={divider()} />
      </TranscriptProvider>,
    );
    expect(view.container.querySelector('button[aria-expanded]')?.textContent).toMatch(/^Worked for /);
    view.unmount();
    store.detach(CHILD_KEY);
  });

  it('main tab first, then the drill-in: the second attach shares the one attachment and state, and outlives the first', async () => {
    const { parent, child } = live();
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const tab = store.attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: [...parent, ...child.slice(0, 2)], lastSeq: 9, complete: true });
    await tab;
    const rows = useTranscriptStore.getState().rows(CHILD_KEY);
    expect(rows.length).toBeGreaterThan(0);
    await store.attach(CHILD_KEY, childSource(fake), { agentId: AGENT }); // the drill-in mounts over the same source
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events']); // no second snapshot
    expect(fake.listeners.get('session.eventBatch')?.size).toBe(1);
    expect(useTranscriptStore.getState().rows(CHILD_KEY)).toBe(rows);
    store.detach(CHILD_KEY); // the tab closes; the drill-in still follows
    fake.emit('session.eventBatch', batch(child.slice(2)));
    expect(useTranscriptStore.getState().entries[CHILD_KEY].state.seen.has(child.at(-1)!.id)).toBe(true);
    store.detach(CHILD_KEY);
    expect(fake.listeners.get('session.eventBatch')?.size).toBe(0);
  });

  it('both mounted at once: one attachment, one state, the same rows in both transcripts', async () => {
    // happy-dom has no layout: a viewport for each scroller and a height per row, so the virtualiser mounts rows.
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-transcript-scroller') ? 2000 : this.hasAttribute('data-index') ? 40 : 0;
      },
    });
    onTestFinished(() => {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
    });
    const { parent, child } = live();
    const fake = fakeClient();
    const source = childSource(fake);
    const view = render(
      <>
        <div data-surface="tab" style={{ height: 600 }}>
          <Transcript source={source} variant="child" />
        </div>
        <div data-surface="drill-in" style={{ height: 600 }}>
          <Transcript source={source} variant="child" />
        </div>
      </>,
    );
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events']);
    expect(fake.listeners.get('session.eventBatch')?.size).toBe(1);
    await act(async () => {
      answer(fake, 'session.events', { events: [...parent, ...child], lastSeq: 9, complete: true });
      await flush();
    });
    const state = useTranscriptStore.getState().entries[CHILD_KEY];
    expect(state.phase).toBe('live');
    expect([...state.state.seen]).toEqual(child.map((event) => event.id));
    const rowIds = (surface: string) => [...view.container.querySelectorAll(`[data-surface="${surface}"] [data-row-id]`)].map((row) => row.getAttribute('data-row-id'));
    expect(rowIds('tab')).toEqual(state.rows.map((row) => row.id));
    expect(rowIds('drill-in')).toEqual(rowIds('tab'));
    view.unmount();
    expect(fake.listeners.get('session.eventBatch')?.size).toBe(0);
  });

  // Whole-branch review: a drill-in open while the child ran, closed, and reopened after it finished. Unobserved, the
  // source saw no end and fired no reset; the reopened attach reads the disk transcript, so the key starts over.
  it('reopened after the child finished unobserved: the key starts over from the disk transcript, no id twice', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const open = store.attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: [...parent, ...child.slice(0, 2)], lastSeq: 9, complete: true });
    await open;
    expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual(child.slice(0, 2).map((event) => event.id));
    store.detach(CHILD_KEY); // the drill-in closes while the child still runs
    const done = finish(AGENT, '2026-09-28T10:00:09.000Z', 'completed');
    const reopened = store.attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: [...parent, ...child, done], lastSeq: 12, complete: true });
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await reopened;
    const entry = useTranscriptStore.getState().entries[CHILD_KEY];
    expect([...entry.state.seen]).toEqual([...disk, done].map((event) => event.id));
    expect(entry.rows).toEqual(rowsOf(applyEvents(createState(null, AGENT), [...disk, done])));
    expect(entry.state.order).toHaveLength(1);
    store.detach(CHILD_KEY);
  });

  it('relaunch of the parent with the child on disk: the exit closes the live child as stopped, resets the key, re-hydrates from disk, no id twice', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: [...parent, ...child.slice(0, 3)], lastSeq: 9, complete: true });
    await hydrated;
    expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual(child.slice(0, 3).map((event) => event.id));

    // The parent's process exits: no finish will come for the live child. The exit joins its slice and closes its turn
    // as stopped; the same source switches to disk and signals a reset.
    const exit = builder('2026-09-28T10:00:09.000Z').emit('process.exited', { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0 }, { id: 'exit' });
    fake.emit('session.eventBatch', batch([child[3], exit]));
    expect(dividerOf(CHILD_KEY).state).toBe('stopped'); // in the live state, before the reset
    await Promise.resolve(); // the reset follows the batch that carried the end
    expect(useTranscriptStore.getState().entries[CHILD_KEY]).toMatchObject({ phase: 'hydrating' });
    expect(useTranscriptStore.getState().rows(CHILD_KEY)).toEqual([]); // the live id form is gone
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events', 'fs.agentEvents']);
    fake.emit('session.eventBatch', batch(disk.slice(2, 3))); // the disk follower, buffered until the backfill lands
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await flush();

    const entry = useTranscriptStore.getState().entries[CHILD_KEY];
    expect(entry.phase).toBe('live');
    expect([...entry.state.seen]).toEqual([...disk, exit].map((event) => event.id));
    expect(entry.rows).toEqual(rowsOf(applyEvents(createState(null, AGENT), [...disk, exit])));
    expect(dividerOf(CHILD_KEY).state).toBe('stopped'); // and again in the disk state
    expect(new Set(entry.rows.map((row) => row.id)).size).toBe(entry.rows.length);
    store.detach(CHILD_KEY);
  });

  it('after the switch to disk, live-form batches are ignored, those buffered during disk hydration included; disk-form events apply', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: [...parent, ...child.slice(0, 2)], lastSeq: 9, complete: true });
    await hydrated;
    const exit = builder('2026-09-28T10:00:09.000Z').emit('process.exited', { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0 }, { id: 'exit' });
    fake.emit('session.eventBatch', batch([exit]));
    await Promise.resolve(); // reset: now hydrating from disk
    // Pending live-form batches still in flight, interleaved with the disk follower's, while the backfill is pending.
    fake.emit('session.eventBatch', batch([child[2], disk[2]]));
    fake.emit('session.eventBatch', batch([child[3]]));
    answer(fake, 'fs.agentEvents', { events: disk.slice(0, 2), complete: true });
    await flush();
    // And after hydration: live form ignored, disk form applied.
    fake.emit('session.eventBatch', batch([child[3], disk[3]]));
    const seen = [...useTranscriptStore.getState().entries[CHILD_KEY].state.seen];
    expect(seen).toEqual([disk[0], disk[1], exit, disk[2], disk[3]].map((event) => event.id));
    expect(seen.some((id) => id.startsWith('live:'))).toBe(false);
    store.detach(CHILD_KEY);
  });

  it('a disk-backed child ignores live-form batches from the first hydration on', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    fake.emit('session.eventBatch', batch([child[0], disk[0]])); // before the provenance is known
    answer(fake, 'session.events', { events: parent.filter((event) => event.kind !== 'subagent.started'), lastSeq: 3, complete: true });
    await flush();
    fake.emit('session.eventBatch', batch([child[1], disk[1]])); // while the disk backfill is pending
    answer(fake, 'fs.agentEvents', { events: disk.slice(0, 1), complete: true });
    await hydrated;
    fake.emit('session.eventBatch', batch([child[2], disk[2]]));
    expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual(disk.slice(0, 3).map((event) => event.id));
    store.detach(CHILD_KEY);
  });

  it('mounting after a crash: an exit after the start in the parent’s snapshot is terminal, so the child is read from disk and reads stopped', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const exit = builder('2026-09-28T10:00:09.000Z').emit('process.exited', { code: null, signal: 'SIGKILL', reason: 'crash', lostAttentionCount: 0 }, { id: 'crash' });
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: [...parent, ...child.slice(0, 2), exit], lastSeq: 9, complete: true });
    await flush();
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events', 'fs.agentEvents']);
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await hydrated;
    expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual([...disk, exit].map((event) => event.id));
    expect(dividerOf(CHILD_KEY).state).toBe('stopped');
    store.detach(CHILD_KEY);
  });

  it('a start that only a disk transcript records (a disk-backed parent, no exit written) never selects the live stream', async () => {
    const { parent, child } = live();
    const fake = fakeClient();
    const snapshot = childSource(fake).snapshot();
    answer(fake, 'session.events', { events: parent.map((event) => ({ ...event, seq: null })), lastSeq: 0, complete: true });
    await flush();
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events', 'fs.agentEvents']);
    answer(fake, 'fs.agentEvents', { events: onDisk(child), complete: true });
    await expect(snapshot).resolves.toEqual(onDisk(child));
  });

  it('a stream batch carrying an exit from before the child’s start (a replay or backfill of the earlier run) switches nothing', async () => {
    const { parent, child } = live();
    const earlier = builder('2026-09-28T09:59:00.000Z').emit('process.exited', { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0 }, { id: 'earlier' });
    const fake = fakeClient();
    const source = childSource(fake);
    const resets = vi.fn();
    source.onReset!(resets);
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(CHILD_KEY, source, { agentId: AGENT });
    fake.emit('session.eventBatch', batch([earlier])); // buffered: the provenance is not known yet
    answer(fake, 'session.events', { events: [earlier, ...parent], lastSeq: 9, complete: true }); // the exit, then this child's start
    await hydrated;
    fake.emit('session.eventBatch', batch([earlier, child[0]])); // the same old exit again, live
    await flush();
    expect(resets).not.toHaveBeenCalled();
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events']);
    expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual([child[0].id]);
    // A new exit, after the start, still ends the child.
    fake.emit('session.eventBatch', batch([builder('2026-09-28T10:00:09.000Z').emit('process.exited', { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0 }, { id: 'later' })]));
    await flush();
    expect(resets).toHaveBeenCalledTimes(1);
    store.detach(CHILD_KEY);
  });

  it('an exit before the child started is no end of it: a child started after a relaunch is live', async () => {
    const { parent, child } = live();
    const exit = builder('2026-09-28T09:59:00.000Z').emit('process.exited', { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0 }, { id: 'earlier' });
    const fake = fakeClient();
    const snapshot = childSource(fake).snapshot();
    answer(fake, 'session.events', { events: [exit, ...parent, ...child.slice(0, 1)], lastSeq: 9, complete: true });
    await expect(snapshot).resolves.toEqual(child.slice(0, 1));
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events']);
  });

  it('a live child’s own end (subagent.finished or a terminal task.notification for its task) switches it to disk too', async () => {
    for (const end of ['subagent.finished', 'task.notification'] as const) {
      const { parent, child } = live();
      const fake = fakeClient();
      const source = childSource(fake);
      const resets = vi.fn();
      source.onReset!(resets);
      source.subscribe(() => {});
      const snapshot = source.snapshot();
      answer(fake, 'session.events', { events: [...parent, ...child], lastSeq: 9, complete: true });
      await snapshot;
      const ending = (taskId: string, at: string) => {
        const b = builder(at);
        if (end === 'subagent.finished') b.emit('subagent.finished', { taskId: taskId as TaskId, status: 'completed', summary: null, outputFile: null, reason: null });
        else b.emit('task.notification', { taskId: taskId as TaskId, toolUseId: null, status: 'completed', summary: 'done', outputFile: null, reason: null });
        return b.events;
      };
      fake.emit('session.eventBatch', batch(ending('agent-8', '2026-09-28T10:00:09.000Z'))); // another agent's end changes nothing
      await flush();
      expect(resets).not.toHaveBeenCalled();
      fake.emit('session.eventBatch', batch(ending(AGENT, '2026-09-28T10:00:10.000Z')));
      fake.emit('session.eventBatch', batch(ending(AGENT, '2026-09-28T10:00:11.000Z'))); // a later end: already on disk
      await flush();
      expect(resets).toHaveBeenCalledTimes(1);
      const again = source.snapshot();
      expect(fake.calls.at(-1)?.name).toBe('fs.agentEvents'); // disk from here on
      answer(fake, 'fs.agentEvents', { events: onDisk(child), complete: true });
      await again;
    }
  });
});

describe('default loadSpill', () => {
  it('reads the spill through fs.readSpill, up to the 2 MB head, and rejects with the X2 error', async () => {
    const fake = fakeClient();
    const load = ipcLoadSpillOver(fake.client);
    const spill = { path: '/cfg/projects/p/s/tool-results/toolu_1.txt', bytes: 188_416, state: 'not_loaded' as const, content: null };
    const loaded = load(spill);
    expect(fake.calls.map((call) => [call.name, call.input])).toEqual([['fs.readSpill', { path: spill.path, length: 2 * 1024 * 1024 }]]);
    fake.calls[0].answer({ ok: true, value: { content: 'full', bytes: 4, offset: 0, length: 4, truncated: false } }); // C4's landed shape: `length` is the page's bytes
    await expect(loaded).resolves.toBe('full');
    const refused = load(spill);
    fake.calls[1].answer({ ok: false, error: { code: 'internal', message: 'path outside the engine store' } });
    await expect(refused).rejects.toThrow('path outside the engine store');
  });
});

describe('rewind adapter', () => {
  const OUTCOME = { ok: true, enabled: true, message: null, dryRun: true, changedFiles: ['/p/a.ts', '/p/b.ts'], insertions: 3, deletions: 1, skippedLinks: null }; // C3's RewindFilesOutcome

  function turns() {
    const b = builder();
    b.turn('u1');
    b.end(['u1']);
    b.emit('turn.started', { userMessageUuid: null, origin: 'engine' }, { id: 'engine-1' });
    b.text('m2', 0, 'Continued.');
    b.end([], { origin: 'task-notification' });
    return applyEvents(createState(null, null), b.events);
  }

  it('dry-runs session.rewindFiles for canUndo and rewinds for undo, by the turn’s prompt; Reapply is not offered', async () => {
    const fake = fakeClient();
    const state = turns();
    const rewind = ipcRewindOver(fake.client, APP, () => state);
    expect(rewind.reapply).toBeNull();

    const check = rewind.canUndo(turnId.ofMessage(uuid('u1')));
    expect(fake.calls[0].input).toEqual({ appSessionId: APP, userMessageUuid: 'u1', dryRun: true });
    fake.calls[0].answer({ ok: true, value: OUTCOME });
    await expect(check).resolves.toEqual({ ok: true, reason: null });

    const undo = rewind.undo(turnId.ofMessage(uuid('u1')));
    expect(fake.calls[1].input).toEqual({ appSessionId: APP, userMessageUuid: 'u1', dryRun: false });
    fake.calls[1].answer({ ok: true, value: OUTCOME });
    await expect(undo).resolves.toBeUndefined();
  });

  it('answers a refusal with its reason: checkpoints off, a failed dry run, an unreachable host, an engine turn', async () => {
    const fake = fakeClient();
    const state = turns();
    const rewind = ipcRewindOver(fake.client, APP, () => state);
    const u1 = turnId.ofMessage(uuid('u1'));

    const off = rewind.canUndo(u1);
    fake.calls[0].answer({ ok: true, value: { ...OUTCOME, ok: false, enabled: false, message: null } });
    await expect(off).resolves.toEqual({ ok: false, reason: 'File checkpoints are off for this session' });

    const failed = rewind.canUndo(u1);
    fake.calls[1].answer({ ok: true, value: { ...OUTCOME, ok: false, message: 'No file checkpoint found for this message.' } });
    await expect(failed).resolves.toEqual({ ok: false, reason: 'No file checkpoint found for this message.' });

    const down = rewind.canUndo(u1);
    fake.calls[2].answer({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is not running' } });
    await expect(down).resolves.toEqual({ ok: false, reason: 'engine-host is not running' });

    await expect(rewind.canUndo(state.order[1])).resolves.toEqual({ ok: false, reason: 'This turn has no prompt to rewind to' });
    expect(fake.calls).toHaveLength(3);

    const undo = rewind.undo(u1);
    fake.calls[3].answer({ ok: true, value: { ...OUTCOME, ok: false, message: 'Rewind failed: file changed on disk' } });
    await expect(undo).rejects.toThrow('Rewind failed: file changed on disk');
  });
});
