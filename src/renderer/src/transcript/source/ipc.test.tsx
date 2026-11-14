// The IPC adapters (C6 M5) against a fake X2 client: `ipcSource` under the store's hydration protocol (live batches
// from `session.eventBatch`, the snapshot from `session.events`, or `fs.agentEvents` for a child), the default
// `loadSpill` over `fs.readSpill`, and the receipt's rewind interface over `session.rewindFiles`.
import type { SessionEvent } from '@shared/graph/events';
import { FOLLOW_RELEASED } from '@shared/graph/history-window';
import type { AgentId, AppSessionId, EventId, MessageUuid, ParentToolUseId, TaskId } from '@shared/graph/ids';
import type { CommandName, CommandResult, EventName, EventPayload, EventSource, MawsBridge } from '@shared/ipc/schema';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { addressOf, bareOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { useTranscriptStore } from '../../stores/transcript';
import { rowsOf } from '../model/derive';
import { turnId } from '../model/keys';
import { applyEvents, createState } from '../model/reduce';
import type { Row } from '../model/rows';
import { builder, tool, uuid } from '../model/test-events';
import { Disclosures, NO_ACTIONS, TranscriptProvider } from '../view/context';
import { RowView } from '../view/rows/Row';
import { Transcript } from '../view/Transcript';
import { HOST_RETURN_WAIT_MS, ipcLoadSpillOver, ipcOpenExternalOver, ipcRewindOver, ipcSourceOver, KNOWN_WAIT_MS, REMOTE_ADOPTIONS_POLL_MS, REMOTE_FOLLOW_POLL_MS } from './ipc';
import type { TranscriptSource } from './types';
import { HISTORY_GAP, HISTORY_OMITTED, HISTORY_TOO_LARGE } from '../model/gap'; // P5 O7 M2; M4: HISTORY_OMITTED
import { useMachines } from '../../stores/machines'; // P5 O7 M2
import { useHosts } from '../../stores/hosts'; // the UX wave, U9 (O-11b)
import { humanTurn, record, status } from '../../../../../test/support/builders'; // P5 O7 M8
import { remoteSessionState } from '../../lane-b/test-support/remote-session'; // P5 O15 M2b
import { applyRemoteSession, resetRemoteLaneBStore } from '../../lane-b/remote-session'; // P5 O15 M2b
import type { RemoteAnswer, RemoteSession } from '@shared/ipc/schema/remote'; // P5 O15 M2b
import { loadUxwaveJournal } from '../../../../../test/support/fixtures'; // UX wave U4a
import { journalToEvents } from '../dev/journal'; // UX wave U4a

const APP = at('app-1' as AppSessionId); // the page's: the sources run behind the client, over addresses
const MAIN_APP = bareOf(APP); // P5 O6 M2: an event id is main's, under the bare app id
const AGENT = 'agent-7' as AgentId;

// A fake X2 client (the page's side, on `TEST_MACHINE`): every invoke waits for the test to answer it, but for main's `session.appEvents`, answered at once
// from `appEvents` (what main's read model keeps), and main's `host.status`, answered at once from `hostStatus` (P5 O16
// M3c: a ready host with no session hosts, unless a case sets it); events are pushed by name.
function fakeClient() {
  const listeners = new Map<string, Set<(payload: unknown, from: EventSource) => void>>();
  const calls: { name: string; input: unknown; machine?: MachineRef; answer: (result: CommandResult<CommandName>) => void; answered?: boolean }[] = [];
  const appEvents = new Map<AppSessionId, SessionEvent[]>();
  const host = { status: { state: 'ready', supervisor: { pid: 1 } } as unknown, asked: 0 /* P5 O16 M3c fix wave 2: host.status reads */ };
  const client: MawsBridge = {
    localMachine: TEST_MACHINE,
    invoke: ((name: CommandName, input: unknown, opts?: { machine?: MachineRef }) =>
      name === 'session.appEvents'
        ? Promise.resolve({ ok: true, value: { events: appEvents.get((input as { appSessionId: AppSessionId }).appSessionId) ?? [] } })
        : name === 'host.status'
          ? ((host.asked += 1), Promise.resolve({ ok: true, value: host.status }))
          : new Promise((resolve) => calls.push({ name, input, ...(opts?.machine && { machine: opts.machine }), answer: resolve as never }))) as MawsBridge['invoke'],
    on: ((name: EventName, listener: (payload: unknown, from: EventSource) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    }) as MawsBridge['on'],
    pathForFile: () => '', // C7: MawsBridge gained pathForFile
  };
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>, machine: MachineRef = TEST_MACHINE) => {
    for (const listener of listeners.get(name) ?? []) listener(payload, { machine });
  };
  return { client, calls, emit, listeners, appEvents, host };
}

const batch = (events: SessionEvent[], appSessionId = APP) => ({ appSessionId, events });
// The sources' own `session.eventBatch` listeners.
const subscriptions = (fake: ReturnType<typeof fakeClient>) => fake.listeners.get('session.eventBatch')?.size ?? 0;

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
    expect(subscriptions(fake)).toBe(1);
    expect(fake.calls.map((call) => [call.name, call.input])).toEqual([['session.events', { appSessionId: APP, afterSeq: null, limit: null }]]);

    fake.emit('session.eventBatch', batch(all.slice(2, 4))); // before the snapshot: buffered; the snapshot carries both
    fake.emit('session.eventBatch', batch([...all.slice(4, 6), ...all.slice(6, 8)])); // half overlaps the snapshot's seq-null tail
    fake.emit('session.eventBatch', batch(all.slice(0, 12), at('app-other' as AppSessionId))); // another session: ignored
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
    const liveForm = r.events.map((event, i) => ({ ...event, id: `${MAIN_APP}:launch-2:${i + 1}:0` as EventId, seq: i + 1 }));
    const diskForm = r.events.map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null }));
    const notice = { ...r.emit('notice.posted', { level: 'warning', key: 'relay:direct_fallback', text: 'Direct route.' }), id: `${MAIN_APP}:c10:relay-fallback:1` as EventId, seq: null };

    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, APP);
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(source.key!, source);
    fake.calls[0].answer({ ok: true, value: { events: history, lastSeq: 0, complete: true } } as never);
    await hydrated;
    fake.emit('session.eventBatch', batch(liveForm.slice(0, 2)));
    fake.emit('session.eventBatch', batch([...diskForm.slice(0, 2), notice])); // the follower's copy, and the app's notice
    fake.appEvents.set(APP, [notice]); // main's read model keeps the notice as it emits it
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
    // the app's notice, which no journal snapshot carries, comes back from main's copy at its place in time (the last)
    expect([...useTranscriptStore.getState().entries[APP].state.seen]).toEqual([...liveForm, notice].map((event) => event.id));
    store.detach(source.key!);
  });

  // Two subscriptions at once (a second attach before the first detached): each keeps its own live preference, held
  // batches and listener, and each snapshot serves the subscription made just before it.
  it('keeps concurrent subscriptions apart: neither snapshot nor batch crosses into the other', async () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Reply.');
    b.end(['u1']);
    const liveForm = b.events.map((event, i) => ({ ...event, id: `${MAIN_APP}:launch-1:${i + 1}:0` as EventId, seq: i + 1 }));
    const diskForm = b.events.map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null }));
    const fake = fakeClient();
    const subject = ipcSourceOver(fake.client, APP);
    const first: EventId[] = [];
    const second: EventId[] = [];
    subject.subscribe((events) => first.push(...events.map((event) => event.id)));
    const firstSnapshot = subject.snapshot();
    subject.subscribe((events) => second.push(...events.map((event) => event.id)));
    const secondSnapshot = subject.snapshot();
    fake.calls[0].answer({ ok: true, value: { events: liveForm, lastSeq: liveForm.length, complete: true } } as never); // the first sees live
    fake.calls[1].answer({ ok: true, value: { events: [], lastSeq: 0, complete: true } } as never); // the second, nothing yet
    await Promise.all([firstSnapshot, secondSnapshot]);
    fake.emit('session.eventBatch', batch(diskForm));
    expect(first).toEqual([]); // live seen: the follower's copies drop
    expect(second).toEqual(diskForm.map((event) => event.id)); // no live seen: the disk form is all it has
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

  // (A failure because the engine host was away waits for its return first: the UX wave's O-11b, below.)
  it('a failed snapshot rejects with the X2 error, and the store marks the key failed', async () => {
    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, APP);
    const hydrated = useTranscriptStore.getState().attach(APP, source);
    fake.calls[0].answer({ ok: false, error: { code: 'internal', message: 'session.events: the journal could not be read' } });
    await hydrated;
    expect(useTranscriptStore.getState().entries[APP]).toMatchObject({ phase: 'failed', error: 'session.events: the journal could not be read' });
    expect(subscriptions(fake)).toBe(0);
  });

  // C10 · C6 (debt wave 5): C10's `relay:direct_fallback` notice is posted once as a batch (main's `directFallbackNotice`)
  // and journalled nowhere, so no `session.events` snapshot carries it; main's read model keeps it. A page that loads
  // after it (a reload: a new client that heard no batch) shows it as a notice row at its place in time, and so does
  // a later hydration (a Retry), once.
  it('shows a route notice main kept from before the page loaded, before the turn it preceded, again after a Retry', async () => {
    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, APP);
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Hello');
    b.end(['u1']);
    const noticeAt = new Date(Date.parse(b.events[0].at) - 50).toISOString(); // posted between the launch and the first send
    const notice = {
      id: `${MAIN_APP}:c10:relay-fallback:1` as EventId, sessionId: 'unknown', at: noticeAt, seq: null, agentId: null, parentToolUseId: null,
      kind: 'notice.posted', level: 'warning', key: 'relay:direct_fallback', text: 'The relay was unreachable, so this session started on the direct route.',
    } as unknown as SessionEvent;
    fake.appEvents.set(APP, [notice]); // posted before this page loaded: main has it, the page never heard it
    const store = useTranscriptStore.getState();
    const answer = { ok: true, value: { events: b.events, lastSeq: b.events.length - 1, complete: true } } as never;
    const hydrated = store.attach(APP, source);
    fake.calls[0].answer(answer);
    await hydrated;
    const noticeRows = () => useTranscriptStore.getState().entries[APP].rows.filter((row) => row.kind === 'error' && row.severity === 'notice');
    expect(noticeRows().map((row) => row.kind === 'error' && row.text)).toEqual(['The relay was unreachable, so this session started on the direct route.']);
    const kinds = useTranscriptStore.getState().entries[APP].rows.map((row) => row.kind);
    expect(kinds.indexOf('error'), 'before the turn it preceded').toBeLessThan(kinds.indexOf('user'));
    expect(fake.calls.map((call) => call.name), 'main is read after the journal, with no call of its own to answer').toEqual(['session.events']);

    // A later hydration of the key (a reset, as a Retry or a reopened tab) still carries it, once.
    store.detach(APP);
    const again = store.attach(APP, source);
    fake.emit('session.eventBatch', batch([notice])); // the same notice held and passed too: deduplicated by id
    fake.calls[1].answer(answer);
    await again;
    expect(noticeRows()).toHaveLength(1);
  });

  // P5 O7 M2 (acceptance 11): "Earlier history isn't available", one bar where the gap is: where a remote session's stream
  // went on past events it could not deliver (`remote.gap`, said in order with its batches), and at the start of a page
  // `session.events` answered with part of its range gone (`historyUnavailable`).
  describe('the gap bar', () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    const turnOf = (b: ReturnType<typeof builder>, n: number) => {
      b.turn(`u${n}`);
      b.text(`m${n}`, 0, `Answer ${n}`);
      b.end([`u${n}`]);
    };
    const kinds = (key: AppSessionId) => useTranscriptStore.getState().entries[key].rows.map((row) => row.kind).filter((kind) => kind !== 'time');

    it('draws it where a remote stream told of a gap, between what came before and what came after', async () => {
      const fake = fakeClient();
      const source = ipcSourceOver(fake.client, REMOTE);
      const hydrated = useTranscriptStore.getState().attach(REMOTE, source);
      fake.calls[0].answer({ ok: true, value: { events: [], lastSeq: 0, complete: true } } as never);
      await hydrated;
      const before = builder();
      turnOf(before, 1);
      fake.emit('session.eventBatch', batch(before.events, REMOTE), OTHER_MACHINE);
      fake.emit('remote.gap', { appSessionId: at('another' as AppSessionId), launchId: 'L2' }); // another session's: nothing
      fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L2' }, OTHER_MACHINE);
      const after = builder();
      turnOf(after, 2);
      fake.emit('session.eventBatch', batch(after.events.map((event) => ({ ...event, id: `${event.id}-2` as EventId })), REMOTE), OTHER_MACHINE);
      const rows = useTranscriptStore.getState().entries[REMOTE].rows;
      const gaps = rows.filter((row) => row.kind === 'gap');
      expect(gaps).toHaveLength(1);
      expect(gaps[0]).toMatchObject({ text: 'Earlier history isn’t available' });
      const order = kinds(REMOTE);
      expect(order.indexOf('gap')).toBeGreaterThan(order.indexOf('assistant_text'));
      expect(order.indexOf('gap')).toBeLessThan(order.lastIndexOf('user'));
      const view = render(<TranscriptProvider value={{ storeKey: REMOTE, variant: 'session', actions: NO_ACTIONS, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 't' }}><RowView row={gaps[0]} /></TranscriptProvider>);
      expect(view.getByRole('status').textContent).toBe('Earlier history isn’t available');
      view.unmount();
    });

    // M2's review: a gap told while the history is still being read stays at its launch's boundary, even when the read
    // already holds the launch after it (the launch's events are named by their ids, `<app>:<launchId>:<seq>:<i>`)
    it('keeps a gap told during the history read before the first event of its launch, or after the history without one', async () => {
      const launched = (b: ReturnType<typeof builder>, launch: string, from: number) => b.events.map((event, i) => ({ ...event, seq: from + i, id: `app-r:${launch}:${from + i}:0` as EventId }));
      const b1 = builder();
      turnOf(b1, 1);
      const b2 = builder();
      turnOf(b2, 2);
      const history = [...launched(b1, 'L1', 1), ...launched(b2, 'L2', 1)];
      for (const [launchId, expected] of [['L2', 'between'], ['L3', 'last']] as const) {
        useTranscriptStore.getState().detach(REMOTE);
        const fake = fakeClient();
        const hydrated = useTranscriptStore.getState().attach(REMOTE, ipcSourceOver(fake.client, REMOTE));
        fake.emit('remote.gap', { appSessionId: REMOTE, launchId }, OTHER_MACHINE);
        fake.calls[0].answer({ ok: true, value: { events: history, lastSeq: 9, complete: true } } as never);
        await hydrated;
        const order = kinds(REMOTE);
        expect(order.filter((kind) => kind === 'gap'), launchId).toHaveLength(1);
        if (expected === 'between') {
          expect(order.indexOf('gap'), launchId).toBeGreaterThan(order.indexOf('assistant_text'));
          expect(order.indexOf('gap'), launchId).toBeLessThan(order.lastIndexOf('user'));
        } else expect(order.at(-1), launchId).toBe('gap');
      }
    });

    // M2's second review: a lost range inside a launch (`missing`) names where the hole ends, its next event the first at
    // or after `at`: the bar goes there, between what survives on either side, not at the launch's start
    it('keeps a lost range’s gap told during the history read at its place inside the launch', async () => {
      const launched = (b: ReturnType<typeof builder>, from: number) => b.events.map((event, i) => ({ ...event, seq: from + i, id: `app-r:L2:${from + i}:0` as EventId }));
      const b1 = builder();
      turnOf(b1, 1);
      const b2 = builder();
      turnOf(b2, 2);
      useTranscriptStore.getState().detach(REMOTE);
      const fake = fakeClient();
      const hydrated = useTranscriptStore.getState().attach(REMOTE, ipcSourceOver(fake.client, REMOTE));
      fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L2', at: { seq: 20, idx: 0 } }, OTHER_MACHINE);
      fake.calls[0].answer({ ok: true, value: { events: [...launched(b1, 1), ...launched(b2, 20)], lastSeq: 40, complete: true } } as never);
      await hydrated;
      const order = kinds(REMOTE);
      expect(order.filter((kind) => kind === 'gap')).toHaveLength(1);
      expect(order.indexOf('gap')).toBeGreaterThan(order.indexOf('assistant_text'));
      expect(order.indexOf('gap')).toBeLessThan(order.lastIndexOf('user'));
    });

    // A gap placed during the read is part of the history the older pages rebuild from, so loading one keeps it
    it('keeps a gap placed during the history read when an older page is loaded', async () => {
      const launched = (b: ReturnType<typeof builder>, launch: string) => b.events.map((event, i) => ({ ...event, seq: 1 + i, id: `app-r:${launch}:${1 + i}:0` as EventId }));
      const b1 = builder();
      turnOf(b1, 1);
      const b2 = builder();
      turnOf(b2, 2);
      const [older, newer] = [launched(b1, 'L1'), launched(b2, 'L2')];
      useTranscriptStore.getState().detach(REMOTE);
      const fake = fakeClient();
      const source = ipcSourceOver(fake.client, REMOTE);
      const hydrated = useTranscriptStore.getState().attach(REMOTE, source);
      fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L2' }, OTHER_MACHINE);
      fake.calls[0].answer({ ok: true, value: { events: newer, lastSeq: 9, complete: true, earlier: newer[0]!.id } } as never);
      await hydrated;
      expect(kinds(REMOTE).filter((kind) => kind === 'gap')).toHaveLength(1);
      source.older!.loadOlder();
      await vi.waitFor(() => expect(fake.calls.filter((call) => call.name === 'session.events')).toHaveLength(2));
      fake.calls.filter((call) => call.name === 'session.events')[1]!.answer({ ok: true, value: { events: older, lastSeq: 9, complete: true } } as never);
      await vi.waitFor(() => expect(kinds(REMOTE).filter((kind) => kind === 'user')).toHaveLength(2));
      const order = kinds(REMOTE);
      expect(order.filter((kind) => kind === 'gap')).toHaveLength(1);
      expect(order.indexOf('gap')).toBeGreaterThan(order.indexOf('assistant_text'));
      expect(order.indexOf('gap')).toBeLessThan(order.lastIndexOf('user'));
    });

    // M2's milestone review: a window main's read can't page across the channel until M4 (acceptance 12) is answered history
    // unavailable after main said why (`remote.historyTooLarge`); its bar says what the person can do, and only its bar
    it('says a remote history too large for the channel can’t be shown yet, new messages still appearing, and an older page that it can’t be shown yet', async () => {
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay' }]);
      const b = builder();
      turnOf(b, 2);
      const newer = b.events.map((event, i) => ({ ...event, seq: 1 + i, id: `app-r:L2:${1 + i}:0` as EventId }));
      const gapTexts = () => useTranscriptStore.getState().entries[REMOTE].rows.flatMap((row) => (row.kind === 'gap' ? [row.text] : []));
      useTranscriptStore.getState().detach(REMOTE);
      const fake = fakeClient();
      const source = ipcSourceOver(fake.client, REMOTE);
      let hydrated = useTranscriptStore.getState().attach(REMOTE, source);
      fake.emit('remote.historyTooLarge', { appSessionId: REMOTE, window: 'newest' }, OTHER_MACHINE);
      fake.calls[0].answer({ ok: true, value: { events: [], lastSeq: 0, complete: true, historyUnavailable: true } } as never);
      await hydrated;
      expect(gapTexts()).toEqual([HISTORY_TOO_LARGE.newest('mini')]);

      useTranscriptStore.getState().detach(REMOTE);
      const reads = () => fake.calls.filter((call) => call.name === 'session.events');
      hydrated = useTranscriptStore.getState().attach(REMOTE, source);
      reads()[1]!.answer({ ok: true, value: { events: newer, lastSeq: 9, complete: true, earlier: newer[0]!.id } } as never);
      await hydrated;
      expect(gapTexts()).toEqual([]); // the newest window read whole this time: no bar
      source.older!.loadOlder();
      await vi.waitFor(() => expect(reads()).toHaveLength(3));
      fake.emit('remote.historyTooLarge', { appSessionId: REMOTE, window: 'older' }, OTHER_MACHINE);
      reads()[2]!.answer({ ok: true, value: { events: [], lastSeq: 0, complete: true, historyUnavailable: true } } as never);
      await vi.waitFor(() => expect(gapTexts()).toEqual([HISTORY_TOO_LARGE.older('mini')]));
      expect(HISTORY_TOO_LARGE.newest('mini')).not.toBe(HISTORY_GAP); // a lost range keeps the generic words (the cases above)
    });

    // P5 O7 M4 (acceptance 12): a machine whose endpoint takes the byte budget answers every window in pages the channel
    // carries, so no too-large bar; an item alone past the budget is left out (`omitted`), just after the page's rows,
    // and a bar there says so, at the newest window's end and at an older page's
    it('marks where a budgeted read left out items too large for the channel, after the rows of the page that says so', async () => {
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay' }]);
      const MiB = 1024 * 1024;
      const disk = (b: ReturnType<typeof builder>, tag: string) => b.events.map((event, i) => ({ ...event, seq: null, id: `app-r:${tag}:${i}` as EventId }));
      const b1 = builder();
      turnOf(b1, 1);
      const b2 = builder();
      turnOf(b2, 2);
      const [older, newer] = [disk(b1, 'older'), disk(b2, 'newer')];
      const gapTexts = () => useTranscriptStore.getState().entries[REMOTE].rows.flatMap((row) => (row.kind === 'gap' ? [row.text] : []));
      useTranscriptStore.getState().detach(REMOTE);
      const fake = fakeClient();
      const source = ipcSourceOver(fake.client, REMOTE);
      const reads = () => fake.calls.filter((call) => call.name === 'session.events');
      const hydrated = useTranscriptStore.getState().attach(REMOTE, source);
      reads()[0]!.answer({ ok: true, value: { events: newer, lastSeq: 0, complete: true, earlier: newer[0]!.id, omitted: { events: 1, bytes: 5 * MiB, seq: null } } } as never);
      await hydrated;
      expect(gapTexts()).toEqual([HISTORY_OMITTED(1, 5 * MiB, 'mini')]);
      expect(kinds(REMOTE).at(-1)).toBe('gap'); // after the newest window's rows
      source.older!.loadOlder();
      await vi.waitFor(() => expect(reads()).toHaveLength(2));
      expect(reads()[1]!.input).toMatchObject({ before: newer[0]!.id });
      reads()[1]!.answer({ ok: true, value: { events: older, lastSeq: 0, complete: true, omitted: { events: 2, bytes: 9 * MiB, seq: null } } } as never);
      await vi.waitFor(() => expect(gapTexts()).toHaveLength(2));
      expect(gapTexts()).toEqual([HISTORY_OMITTED(2, 9 * MiB, 'mini'), HISTORY_OMITTED(1, 5 * MiB, 'mini')]);
      const order = kinds(REMOTE);
      expect(order.indexOf('gap')).toBeGreaterThan(order.indexOf('assistant_text')); // the older page's bar after its rows
      expect(order.indexOf('gap')).toBeLessThan(order.lastIndexOf('user')); // and before the newer window's
      expect(gapTexts()).not.toContain(HISTORY_TOO_LARGE.newest('mini'));
      expect(HISTORY_OMITTED(1, 5 * MiB, 'mini')).toBe('One item (5.0 MB) is too large to show from mini');
      expect(HISTORY_OMITTED(2, 9 * MiB, 'mini')).toBe('2 items (9.0 MB) are too large to show from mini');
    });

    it('draws it at the start of a page whose range is partly gone, once however often the key is read again', async () => {
      const fake = fakeClient();
      const source = ipcSourceOver(fake.client, APP);
      const store = useTranscriptStore.getState();
      const b = builder();
      turnOf(b, 1);
      const answer = { ok: true, value: { events: b.events, lastSeq: 9, complete: false, historyUnavailable: true } } as never;
      const hydrated = store.attach(APP, source);
      fake.emit('remote.historyTooLarge', { appSessionId: REMOTE, window: 'newest' }, OTHER_MACHINE); // another session's reason: not this bar's
      fake.calls[0].answer(answer);
      await hydrated;
      expect(kinds(APP)[0]).toBe('gap');
      expect(kinds(APP).filter((kind) => kind === 'gap')).toHaveLength(1);
      expect(useTranscriptStore.getState().entries[APP].rows.find((row) => row.kind === 'gap')).toMatchObject({ text: HISTORY_GAP });
      store.detach(APP);
      const again = store.attach(APP, source);
      fake.calls[1].answer(answer);
      await again;
      expect(kinds(APP).filter((kind) => kind === 'gap')).toHaveLength(1);
    });

    it('draws none for a page whose history is whole', async () => {
      const fake = fakeClient();
      const b = builder();
      turnOf(b, 1);
      const hydrated = useTranscriptStore.getState().attach(APP, ipcSourceOver(fake.client, APP));
      fake.calls[0].answer({ ok: true, value: { events: b.events, lastSeq: 3, complete: true } } as never);
      await hydrated;
      expect(kinds(APP)).not.toContain('gap');
    });

    // P5 O7 M8 (m8-1, red first; "What draws Working…"): the consumer half of main's gap rule (remote-session.test.ts,
    // "marks an unreadable `turn.ended` as a gap…"). A remote turn whose `turn.ended` never came is open in the store, and
    // the transcript's "Working…" is the store's `working` (`state.current !== null`). Main tells the gap, then folds in the
    // machine's re-read status (idle, `turn: null`) and record; the gap bar is a notice and closes no turn. The rule (m8-4):
    // after a gap, the first status that says the session runs no turn closes the turn left open, as a turn nobody saw end.
    const openRemoteTurn = async () => {
      const fake = fakeClient();
      const source = ipcSourceOver(fake.client, REMOTE);
      const hydrated = useTranscriptStore.getState().attach(REMOTE, source);
      fake.calls[0].answer({ ok: true, value: { events: [], lastSeq: 0, complete: true } } as never);
      await hydrated;
      const b = builder();
      b.turn('u1');
      b.text('m1', 0, 'Working on it');
      fake.emit('session.eventBatch', batch(b.events, REMOTE), OTHER_MACHINE);
      expect(useTranscriptStore.getState().entries[REMOTE].working).toBe(true); // the turn is open
      return { fake, b };
    };
    const idle = { appSessionId: REMOTE, status: { ...status(bareOf(REMOTE)), appSessionId: REMOTE } };
    const working = () => useTranscriptStore.getState().entries[REMOTE].working;

    it('clears a remote turn’s working when the gap is followed by the re-read idle status and record', async () => {
      const { fake } = await openRemoteTurn();
      fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1', at: { seq: 5, idx: 0 } }, OTHER_MACHINE);
      fake.emit('session.status', idle, OTHER_MACHINE);
      fake.emit('session.changed', { record: record(REMOTE), cause: 'live', revision: 2 }, OTHER_MACHINE);
      await vi.waitFor(() => expect(kinds(REMOTE)).toContain('gap'));
      expect(working()).toBe(false);
      expect(kinds(REMOTE).filter((kind) => kind === 'error'), 'no exit notice: nobody saw the process go').toEqual([]);
    });

    it('closes nothing on an idle status with no gap before it: the stream’s own turn.ended closes the turn', async () => {
      const { fake } = await openRemoteTurn();
      fake.emit('session.status', idle, OTHER_MACHINE);
      expect(working()).toBe(true);
    });

    it('after a gap, a turn the stream itself starts or ends is the stream’s again: a later idle status closes nothing', async () => {
      const { fake, b } = await openRemoteTurn();
      fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1', at: { seq: 5, idx: 0 } }, OTHER_MACHINE);
      fake.emit('session.status', { appSessionId: REMOTE, status: { ...status(bareOf(REMOTE), { process: 'ready', engineState: 'running', turn: humanTurn }), appSessionId: REMOTE } }, OTHER_MACHINE);
      expect(working(), 'still running, as the machine says').toBe(true);
      const seen = b.events.length;
      b.end(['u1']);
      b.turn('u2');
      fake.emit('session.eventBatch', batch(b.events.slice(seen), REMOTE), OTHER_MACHINE);
      fake.emit('session.status', idle, OTHER_MACHINE); // said before the new turn's own turn.ended arrives
      expect(working(), 'u2 runs until its own turn.ended').toBe(true);
    });

    it('closes the cut turn as an unseen end, not an exit: the plugins’ lines and the process’s agents stay live', async () => {
      const { fake, b } = await openRemoteTurn();
      const seen = b.events.length;
      b.toolUse('bg1', 'Agent', { description: 'background', prompt: 'go', run_in_background: true }, 'm2');
      b.emit('plugin.status', { plugin: 'alpha', text: 'one' });
      fake.emit('session.eventBatch', batch(b.events.slice(seen), REMOTE), OTHER_MACHINE);
      fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1', at: { seq: 5, idx: 0 } }, OTHER_MACHINE);
      fake.emit('session.status', idle, OTHER_MACHINE);
      const state = useTranscriptStore.getState().entries[REMOTE].state;
      expect(state.current).toBeNull();
      expect([...state.pluginStatus.keys()]).toEqual(['alpha']);
      expect([...state.turns.values()].map((turn) => turn.agentsEndedAt)).toEqual([undefined]);
    });

    it('a child transcript’s turn arriving after the gap is not the parent’s: the status still heals the parent’s turn', async () => {
      const { fake } = await openRemoteTurn();
      fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1', at: { seq: 5, idx: 0 } }, OTHER_MACHINE);
      const child = builder();
      child.turn('child-1');
      child.end(['child-1']);
      const slice = child.events.map((event) => ({ ...event, agentId: 'child-agent', parentToolUseId: null }) as SessionEvent);
      fake.emit('session.eventBatch', batch(slice, REMOTE), OTHER_MACHINE);
      fake.emit('session.status', idle, OTHER_MACHINE);
      expect(working(), 'only the parent’s own turns withdraw its heal').toBe(false);
    });

    // m8-4a's task review (gap-review.test.ts): the healing follows what arrived after the gap, not what a hydration
    // delivers later; main flushes the batches before it emits the re-read status (remote-session.ts)
    describe('while the source hydrates', () => {
      const hydrating = () => {
        const fake = fakeClient();
        const source = ipcSourceOver(fake.client, REMOTE);
        const delivered: SessionEvent[][] = [];
        const off = source.subscribe((events) => delivered.push(events));
        const snapshot = source.snapshot();
        const answer = (events: SessionEvent[]) => fake.calls.find((call) => call.name === 'session.events')!.answer({ ok: true, value: { events, lastSeq: events.length, complete: true } } as never);
        const gap = () => fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1', at: { seq: 5, idx: 0 } }, OTHER_MACHINE);
        const rested = () => fake.emit('session.status', idle, OTHER_MACHINE);
        const state = async () => {
          const history = await snapshot;
          off();
          return applyEvents(createState(null, null), [...history, ...delivered.flat()]);
        };
        return { fake, answer, gap, rested, state, settled: snapshot };
      };

      it('a newer turn that arrived after the gap is not closed by the status that follows it', async () => {
        const f = hydrating();
        const b = builder();
        b.turn('u1');
        b.text('m1', 0, 'old turn');
        const history = [...b.events];
        f.gap();
        const seen = b.events.length;
        b.end(['u1']);
        b.turn('u2');
        f.fake.emit('session.eventBatch', batch(b.events.slice(seen), REMOTE), OTHER_MACHINE);
        f.rested(); // stale for u2, which arrived after the gap: the stream speaks for its turns again
        f.answer(history);
        expect((await f.state()).current, 'u2 is still live').not.toBeNull();
      });

      it('a snapshot replaying the cut turn’s start is history, not an arrival: the status still heals the turn', async () => {
        const f = hydrating();
        const b = builder();
        b.turn('u1');
        b.text('m1', 0, 'old turn');
        f.gap();
        f.answer(b.events);
        await f.settled; // the hydration is over before the status comes
        f.rested();
        expect((await f.state()).current, 'the missed end closes u1').toBeNull();
      });

      it('a heal held behind the hydration gives way to a turn that arrives before it is delivered', async () => {
        const f = hydrating();
        const b = builder();
        b.turn('u1');
        b.text('m1', 0, 'old turn');
        const history = [...b.events];
        f.gap();
        f.rested(); // the heal waits behind the hydration
        const seen = b.events.length;
        b.turn('u2'); // a new turn's start: it closes u1 by its own rule, and the held heal must not close u2
        f.fake.emit('session.eventBatch', batch(b.events.slice(seen), REMOTE), OTHER_MACHINE);
        f.answer(history);
        const state = await f.state();
        expect(state.current, 'u2 runs').toBe(turnId.ofMessage(uuid('u2')));
      });
    });
  });

  // P5 O15 M2b (Decision Log 39): a remote lane B session's tab holds its key while the machine is offline, so the
  // subscription lives through the link's loss. A `replay` opening delivers what it missed into it, and nothing reads the
  // history again; a `remote.gap` heard from the loss until the stream's first batch after the return (`missing`,
  // `snapshot`, a relaunch: main says it only inside the stream's `subbed`, or at the first event after a `missing` one)
  // starts the key over staged, its bar placed in the history as a hydration places one; any later gap only draws its bar.
  describe('held across a lost link', () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'app-h' as AppSessionId);
    const roster = (state: 'up' | 'down', generation: number): EventPayload<'machines.changed'> => ({
      machines: [
        { ref: TEST_MACHINE, name: 'this Mac', local: true, state: 'up', since: '2026-11-10T08:00:00.000Z', generation: 0 },
        { ref: OTHER_MACHINE, name: 'mini', local: false, state, since: '2026-11-10T08:00:00.000Z', generation, ...(state === 'up' && { carrier: 'relay' as const }) },
      ],
    });
    const launched = (b: ReturnType<typeof builder>, launch: string, from: number) => b.events.map((event, i) => ({ ...event, seq: from + i, id: `app-h:${launch}:${from + i}:0` as EventId }));
    const turnOf = (b: ReturnType<typeof builder>, n: number) => {
      b.turn(`u${n}`);
      b.text(`m${n}`, 0, `Answer ${n}`);
      b.end([`u${n}`]);
    };
    const reads = (fake: ReturnType<typeof fakeClient>) => fake.calls.filter((call) => call.name === 'session.events');
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const entry = () => useTranscriptStore.getState().entries[REMOTE];
    const kinds = () => entry().rows.map((row) => row.kind).filter((kind) => kind !== 'time');
    const ofTurn = (n: number) => uuid(`u${n}`);
    // A key hydrated from launch L1's first turn, its source subscribed (the tab's hold and the pane share it).
    async function held() {
      resetRemoteLaneBStore();
      onTestFinished(resetRemoteLaneBStore);
      const fake = fakeClient();
      const source = ipcSourceOver(fake.client, REMOTE);
      const hydrated = useTranscriptStore.getState().attach(REMOTE, source);
      const b = builder();
      turnOf(b, 1);
      const history = launched(b, 'L1', 1);
      reads(fake)[0]!.answer({ ok: true, value: { events: history, lastSeq: history.length, complete: true } } as never);
      await hydrated;
      // a reset empties the key: the fewest turns it held from here on
      let fewest = entry().state.order.length;
      const off = useTranscriptStore.subscribe((state) => void (fewest = Math.min(fewest, state.entries[REMOTE]?.state.order.length ?? 0)));
      onTestFinished(off);
      // main's word on the stream (`remote.session`), as `connectShell` keeps it and the source hears it: with `mode`, the
      // stream's next answer (a `subbed`, or an end leaving it idle or ended); without, a republish of the latest one. The
      // link it names is the one main last said; the roster's word goes with it, as main says both
      let answer: RemoteAnswer | null = null;
      let linkState: 'up' | 'down' = 'up';
      let stream: RemoteSession['stream'] = 'live';
      const said = (now: RemoteSession['stream'], mode?: RemoteAnswer['mode']) => {
        stream = now;
        if (mode !== undefined) answer = { n: (answer?.n ?? 0) + 1, mode };
        const state = remoteSessionState(REMOTE, { stream, answer, link: { state: linkState, carrier: linkState === 'up' ? 'relay' : null, refusal: null, member: 'member-1', rights: [] } });
        applyRemoteSession(state);
        fake.emit('remote.session', state, OTHER_MACHINE);
      };
      said('live', 'snapshot'); // the stream's opening, before any loss
      // the link offline past its grace: main pauses the stream (or says an idle one again) with the link down, then the roster
      const lose = (now: RemoteSession['stream'] = 'paused') => {
        linkState = 'down';
        said(now);
        fake.emit('machines.changed', roster('down', 1));
      };
      // the link up again: the roster, then main says the stream again for the link's change, its answer still to come
      const restore = () => {
        linkState = 'up';
        fake.emit('machines.changed', roster('up', 2));
        said(stream);
      };
      return { fake, source, b, history, lose, restore, said, fewest: () => fewest };
    }
    // the next turn of L1 after `from` events of it, as the stream delivers it
    const nextTurn = (n: number, from: number) => {
      const b = builder();
      turnOf(b, n);
      return launched(b, 'L1', from + 1);
    };

    it('a plain loss and a replay return leave the key unreset and read nothing; the replay’s batches land in order, none twice', async () => {
      const h = await held();
      h.lose();
      // what main says at the return before and around the replay: the roster's new generation, the record and the
      // status said again, the panels' relists, the stream's own state: `live`, a replay's `subbed`
      h.restore();
      h.said('live', 'replay');
      h.fake.emit('session.changed', { record: record(REMOTE), cause: 'live', revision: 1 }, OTHER_MACHINE);
      h.fake.emit('session.status', { appSessionId: REMOTE, status: { ...status(bareOf(REMOTE)), appSessionId: REMOTE } }, OTHER_MACHINE);
      h.fake.emit('fs.tasksChanged', { listId: 'tasks-1' }, OTHER_MACHINE);
      h.fake.emit('remote.reopened', { appSessionId: REMOTE }, OTHER_MACHINE);
      const second = nextTurn(2, h.history.length);
      const third = nextTurn(3, h.history.length + second.length);
      // the replay from the cursor: its first batch repeats the cursor's event, which the store already holds
      h.fake.emit('session.eventBatch', batch([h.history.at(-1)!, ...second.slice(0, 2)], REMOTE), OTHER_MACHINE);
      h.fake.emit('session.eventBatch', batch([...second.slice(2), ...third], REMOTE), OTHER_MACHINE);
      await Promise.resolve();
      expect(reads(h.fake), 'no history read: the replay delivers what the loss held back').toHaveLength(1);
      expect(h.fake.calls.map((call) => call.name)).not.toContain('engine.sessions');
      expect(h.fewest(), 'never reset').toBe(1);
      expect(entry().phase).toBe('live');
      expect(entry().state.order).toEqual([turnId.ofMessage(ofTurn(1)), turnId.ofMessage(ofTurn(2)), turnId.ofMessage(ofTurn(3))]);
      expect([...entry().state.seen]).toEqual([...h.history, ...second, ...third].map((event) => event.id));
      expect(kinds()).not.toContain('gap');
    });

    it('a remote.gap from the loss to the first batch after the return starts one staged re-read, the drawn rows kept until it installs', async () => {
      const h = await held();
      h.lose();
      h.restore();
      expect(reads(h.fake), 'not before the stream speaks').toHaveLength(1);
      const drawn = entry().rows;
      // a relaunch during the loss: the stream answers `snapshot`, and main tells the gap at its `subbed`
      h.fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L2' }, OTHER_MACHINE);
      h.said('gap', 'snapshot'); // the `subbed`'s own word, after its gap
      await vi.waitFor(() => expect(reads(h.fake)).toHaveLength(2));
      expect(reads(h.fake)[1]!.input).toEqual({ appSessionId: REMOTE, afterSeq: null, limit: null });
      expect(entry().phase).toBe('hydrating');
      expect(entry().rows, 'the old rows stay drawn while the history is read').toBe(drawn);
      const b = builder();
      turnOf(b, 2);
      const relaunched = launched(b, 'L2', 1);
      h.fake.emit('session.eventBatch', batch(relaunched.slice(0, 2), REMOTE), OTHER_MACHINE); // held behind the read
      reads(h.fake)[1]!.answer({ ok: true, value: { events: [...h.history, ...relaunched.slice(0, 1)], lastSeq: 1, complete: true } } as never);
      await vi.waitFor(() => expect(entry().phase).toBe('live'));
      expect(h.fewest(), 'staged: the key never drew empty').toBe(1);
      const order = kinds();
      expect(order.filter((kind) => kind === 'gap'), 'one bar').toHaveLength(1);
      expect(order.indexOf('gap'), 'placed before the relaunch’s first event').toBeGreaterThan(order.indexOf('assistant_text'));
      expect(order.indexOf('gap')).toBeLessThan(order.lastIndexOf('user'));
      expect([...entry().state.seen].filter((id) => !id.includes('history-gap'))).toEqual([...h.history, ...relaunched.slice(0, 2)].map((event) => event.id));
      expect(reads(h.fake), 'once').toHaveLength(2);
    });

    it('a remote.gap after a replay answer since the return only draws its bar', async () => {
      const h = await held();
      h.lose();
      h.restore();
      h.said('live', 'replay');
      h.fake.emit('session.eventBatch', batch(nextTurn(2, h.history.length), REMOTE), OTHER_MACHINE);
      h.fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1', at: { seq: 40, idx: 0 } }, OTHER_MACHINE); // an omitted event mid-stream
      await Promise.resolve();
      expect(reads(h.fake)).toHaveLength(1);
      expect(kinds().at(-1)).toBe('gap');
      expect(entry().phase).toBe('live');
    });

    it('a batch said between the loss and the return arms nothing away: the return’s gap still re-reads', async () => {
      const h = await held();
      h.lose();
      h.fake.emit('session.eventBatch', batch(nextTurn(2, h.history.length), REMOTE), OTHER_MACHINE); // flushed after the roster's down
      h.restore();
      h.fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L2' }, OTHER_MACHINE);
      h.said('gap', 'snapshot'); // the `subbed`'s own word, after its gap
      await vi.waitFor(() => expect(reads(h.fake)).toHaveLength(2));
    });

    it('a second loss during the staged re-read re-arms it; the next return’s gap re-reads once', async () => {
      const h = await held();
      h.lose();
      h.restore();
      h.fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L2' }, OTHER_MACHINE);
      h.said('gap', 'snapshot'); // the `subbed`'s own word, after its gap
      await vi.waitFor(() => expect(reads(h.fake)).toHaveLength(2));
      h.lose(); // the re-read is still out
      h.restore();
      expect(reads(h.fake)).toHaveLength(2);
      h.fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L3' }, OTHER_MACHINE);
      h.said('gap', 'snapshot');
      await vi.waitFor(() => expect(reads(h.fake)).toHaveLength(3));
      await Promise.resolve();
      expect(reads(h.fake), 'once').toHaveLength(3);
      // the first re-read answers late: its hydration was superseded, and it installs nothing
      reads(h.fake)[1]!.answer({ ok: true, value: { events: h.history.slice(0, 1), lastSeq: 1, complete: true } } as never);
      const b = builder();
      turnOf(b, 2);
      const relaunched = launched(b, 'L3', 1);
      reads(h.fake)[2]!.answer({ ok: true, value: { events: [...h.history, ...relaunched], lastSeq: relaunched.length, complete: true } } as never);
      await vi.waitFor(() => expect(entry().phase).toBe('live'));
      expect([...entry().state.seen].filter((id) => !id.includes('history-gap'))).toEqual([...h.history, ...relaunched].map((event) => event.id));
      expect(kinds().filter((kind) => kind === 'gap'), 'the second return’s bar alone: the first was told to the superseded read').toHaveLength(1);
      expect(h.fewest()).toBe(1);
    });

    // The architect's rulings on the reviews (P1, the two P2s): the stream's answer after the loss decides, as main says it
    // with `remote.session` (`answer`), never the published state, which a link change says again. `replay` keeps the
    // rows; `missing`, `snapshot`, `unavailable` and `ended` read the key again, staged, at that answer; nothing is read
    // before it, and a gap heard meanwhile (the stream's own, or a history read's: src/main/lane-b/remote.ts) joins it.
    it('holds a gap heard before the answer: a replay answer draws its bar and reads nothing', async () => {
      const h = await held();
      h.lose();
      h.restore(); // the link up, the stream not yet answered
      h.fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1', at: { seq: 9, idx: 0 } }, OTHER_MACHINE); // a history read's
      h.said('opening');
      await settle();
      expect(reads(h.fake), 'held: the stream has not answered').toHaveLength(1);
      expect(kinds()).not.toContain('gap');
      h.said('live', 'replay');
      await settle();
      expect(reads(h.fake)).toHaveLength(1);
      expect(kinds().at(-1)).toBe('gap');
    });

    it('holds a gap heard before the answer: a snapshot answer reads once, the bar placed as its snapshot places it', async () => {
      const h = await held();
      h.lose();
      h.restore();
      h.fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1', at: { seq: 9, idx: 0 } }, OTHER_MACHINE);
      await settle();
      expect(reads(h.fake)).toHaveLength(1);
      h.said('live', 'snapshot');
      await vi.waitFor(() => expect(reads(h.fake)).toHaveLength(2));
      h.said('live');
      await settle();
      expect(reads(h.fake), 'exactly one').toHaveLength(2);
      reads(h.fake)[1]!.answer({ ok: true, value: { events: h.history, lastSeq: h.history.length, complete: true } } as never);
      await vi.waitFor(() => expect(entry().phase).toBe('live'));
      expect(kinds().filter((kind) => kind === 'gap')).toHaveLength(1);
    });

    // P2-1: an idle stream's retry opened while the link was offline, so no `paused` came; at the return `remote.session`
    // says `idle` again for the link's change, while that subscription still waits for its answer
    it('reads nothing at a republish with no new answer: an idle stream’s retry still out at the return', async () => {
      const h = await held();
      h.said('idle', 'unavailable'); // the session released before the loss
      h.lose('idle'); // no subscription to pause: the link's change said again
      h.restore(); // and again at the return, while the retry opened during the loss waits for its answer
      await settle();
      expect(reads(h.fake)).toHaveLength(1);
      h.said('idle', 'unavailable'); // the retry's answer
      await vi.waitFor(() => expect(reads(h.fake)).toHaveLength(2));
    });

    // P2-2: `behind` replaced the subscription and the link failed before its first answer; a fresh sink's `snapshot` (B
    // relaunched the session) tells no gap and says `live`
    it('reads again at a snapshot answer that told no gap and says live', async () => {
      const h = await held();
      h.lose();
      h.restore();
      const drawn = entry().rows;
      h.said('live', 'snapshot');
      await vi.waitFor(() => expect(reads(h.fake)).toHaveLength(2));
      expect(entry().rows, 'staged: the old rows stay drawn').toBe(drawn);
    });

    it('re-reads at a missing answer, and its gap told after it is placed by that read', async () => {
      const h = await held();
      h.lose();
      h.restore();
      h.said('gap', 'missing'); // the `missing` subbed: its gap waits for its first event's place
      await vi.waitFor(() => expect(reads(h.fake)).toHaveLength(2));
      h.fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1', at: { seq: 2, idx: 0 } }, OTHER_MACHINE);
      await settle();
      expect(reads(h.fake)).toHaveLength(2);
      reads(h.fake)[1]!.answer({ ok: true, value: { events: h.history, lastSeq: h.history.length, complete: true } } as never);
      await vi.waitFor(() => expect(entry().phase).toBe('live'));
      expect(kinds().filter((kind) => kind === 'gap')).toHaveLength(1);
    });

    for (const [word, mode] of [['idle', 'unavailable'], ['ended', 'ended']] as const) {
      it(`a return answered ${mode} (the stream ${word}) starts one staged re-read of the live key`, async () => {
        const h = await held();
        h.lose();
        h.restore();
        await settle();
        expect(reads(h.fake)).toHaveLength(1);
        const drawn = entry().rows;
        h.said(word, mode);
        await vi.waitFor(() => expect(reads(h.fake)).toHaveLength(2));
        expect(reads(h.fake)[1]!.input).toEqual({ appSessionId: REMOTE, afterSeq: null, limit: null });
        expect(entry().rows, 'the old rows stay drawn').toBe(drawn);
        h.said(word);
        await settle();
        const more = nextTurn(2, h.history.length);
        reads(h.fake)[1]!.answer({ ok: true, value: { events: [...h.history, ...more], lastSeq: h.history.length + more.length, complete: true } } as never);
        await vi.waitFor(() => expect(entry().phase).toBe('live'));
        expect([...entry().state.seen]).toEqual([...h.history, ...more].map((event) => event.id));
        expect(h.fewest(), 'staged').toBe(1);
        expect(reads(h.fake), 'once').toHaveLength(2);
      });
    }

    it('reads once at an unavailable answer with a gap held before it', async () => {
      const h = await held();
      h.lose();
      h.restore();
      h.fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1', at: { seq: 9, idx: 0 } }, OTHER_MACHINE);
      h.said('idle', 'unavailable');
      await vi.waitFor(() => expect(reads(h.fake)).toHaveLength(2));
      await settle();
      expect(reads(h.fake)).toHaveLength(2);
    });

    it('after the re-read, the fresh subscription behaves as with no loss: a later gap draws its bar only', async () => {
      const h = await held();
      h.lose();
      h.restore();
      h.said('idle', 'unavailable');
      await vi.waitFor(() => expect(reads(h.fake)).toHaveLength(2));
      reads(h.fake)[1]!.answer({ ok: true, value: { events: h.history, lastSeq: h.history.length, complete: true } } as never);
      await vi.waitFor(() => expect(entry().phase).toBe('live'));
      h.said('live', 'snapshot'); // the session runs again: a fresh subscription's opening
      h.fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1', at: { seq: 9, idx: 0 } }, OTHER_MACHINE);
      await settle();
      expect(reads(h.fake)).toHaveLength(2);
      expect(kinds().at(-1)).toBe('gap');
    });

    // the architect's condition (d): main had the return's answer before the renderer's roster said the machine left `up`;
    // the source armed at main's own word of the loss, in main's order, so the answer still decides
    it('decides on an answer main said before the roster said the machine left up', async () => {
      const h = await held();
      // main's word of the loss (the stream paused, the link down), then its answer at the return, both before the roster
      h.fake.emit('remote.session', { ...remoteSessionState(REMOTE, { stream: 'paused', answer: { n: 1, mode: 'snapshot' } }), link: { state: 'down', carrier: null, refusal: null, member: 'member-1', rights: [] } }, OTHER_MACHINE);
      h.said('live', 'snapshot'); // the return's answer (B relaunched it), the link up again in main's word
      await vi.waitFor(() => expect(reads(h.fake)).toHaveLength(2));
      h.fake.emit('machines.changed', roster('down', 1)); // the roster, late
      h.fake.emit('machines.changed', roster('up', 2));
      await settle();
      expect(reads(h.fake), 'once').toHaveLength(2);
    });

    // the architect's condition (c): a source that attached after the loss has nothing armed
    it('arms nothing for a subscription made during the loss', async () => {
      const h = await held();
      h.lose();
      useTranscriptStore.getState().drop(REMOTE); // the key let go during the loss; a mount attaches it again then
      const again = useTranscriptStore.getState().attach(REMOTE, h.source);
      reads(h.fake)[1]!.answer({ ok: true, value: { events: h.history, lastSeq: h.history.length, complete: true } } as never);
      await again;
      h.restore();
      h.said('live', 'snapshot');
      await settle();
      expect(reads(h.fake), 'no re-read: its own read came after the loss').toHaveLength(2);
      useTranscriptStore.getState().detach(REMOTE);
    });

    it('a local session’s source listens for no machine’s link; another machine’s session’s does', async () => {
      const said = (fake: ReturnType<typeof fakeClient>) => fake.listeners.get('remote.session')?.size ?? 0;
      const local = fakeClient();
      await subscribed(local, ipcSourceOver(local.client, APP), () => {});
      expect(said(local), 'local').toBe(0);
      const remote = fakeClient();
      await subscribed(remote, ipcSourceOver(remote.client, REMOTE), () => {});
      expect(said(remote), 'remote').toBe(1);
    });
  });

  // C6 · C10 (debt wave 4): a session started through "+" shows its pane when main records it, before C3's launch has
  // wired its stream and before its engine id is bound, so the first read is refused. The source asks again at the
  // session's first sign of life instead of failing the key.
  describe('a session the engine host does not know yet', () => {
    const UNKNOWN = { ok: false, error: { code: 'internal', message: `unknown app session: ${APP}` } } as const;
    const EMPTY = { ok: true, value: { events: [], lastSeq: 0, complete: true } } as never;
    const settle = () => act(async () => {});

    it('stays hydrating through the refusal and reads again at the session’s status, then goes live', async () => {
      const fake = fakeClient();
      const source = ipcSourceOver(fake.client, APP);
      const hydrated = useTranscriptStore.getState().attach(APP, source);
      fake.calls[0].answer(UNKNOWN);
      await settle();
      expect(fake.calls).toHaveLength(1);
      expect(useTranscriptStore.getState().entries[APP]).toMatchObject({ phase: 'hydrating', error: null });
      fake.emit('session.status', { appSessionId: at('another' as AppSessionId), status: {} as never });
      await settle();
      expect(fake.calls, 'another session’s sign wakes nothing').toHaveLength(1);
      fake.emit('session.status', { appSessionId: APP, status: {} as never });
      await settle();
      expect(fake.calls.map((call) => call.name)).toEqual(['session.events', 'session.events']);
      const events = builder();
      events.turn('u1');
      fake.calls[1].answer({ ok: true, value: { events: events.events, lastSeq: events.events.length - 1, complete: true } } as never);
      await hydrated;
      expect(useTranscriptStore.getState().entries[APP].phase).toBe('live');
      expect(useTranscriptStore.getState().entries[APP].rows.some((row) => row.kind === 'user')).toBe(true);
      expect(fake.listeners.get('session.status')?.size, 'the wait stopped listening').toBe(0);
    });

    it('reads again at once when the sign arrived while the refusal was on its way (a batch, or the record bound)', async () => {
      for (const sign of ['batch', 'record'] as const) {
        const fake = fakeClient();
        const hydrated = useTranscriptStore.getState().attach(APP, ipcSourceOver(fake.client, APP));
        if (sign === 'batch') fake.emit('session.eventBatch', batch([]));
        else fake.emit('session.changed', { record: { appId: APP, holder: { kind: 'none' } } as never, cause: 'live' as never, revision: 1 });
        fake.calls[0].answer(UNKNOWN);
        await settle();
        expect(fake.calls, sign).toHaveLength(2);
        fake.calls[1].answer(EMPTY);
        await hydrated;
        expect(useTranscriptStore.getState().entries[APP].phase).toBe('live');
        useTranscriptStore.getState().drop(APP);
      }
    });

    it('gives up at once when the key detaches while it waits, and fails the key when no sign comes in time', async () => {
      const fake = fakeClient();
      const store = useTranscriptStore.getState();
      const source = ipcSourceOver(fake.client, APP);
      const first = store.attach(APP, source);
      fake.calls[0].answer(UNKNOWN);
      await settle();
      store.detach(APP);
      await first;
      expect(fake.calls).toHaveLength(1);
      expect(fake.listeners.get('session.status')?.size, 'nothing left listening').toBe(0);

      vi.useFakeTimers();
      onTestFinished(() => void vi.useRealTimers());
      const second = store.attach(APP, source);
      fake.calls[1].answer(UNKNOWN);
      await vi.advanceTimersByTimeAsync(KNOWN_WAIT_MS);
      await second;
      expect(fake.calls).toHaveLength(2);
      expect(useTranscriptStore.getState().entries[APP]).toMatchObject({ phase: 'failed', error: `unknown app session: ${APP}` });
    });
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
  const followState = (state: 'following' | 'stopped' | 'error'): EventPayload<'fs.followState'> => ({
    appSessionId: APP, agentId: AGENT, state, chainLength: 0, leafUuid: null, gap: null, skippedLines: 0, message: null,
  });
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
    expect(fake.calls.map((call) => [call.name, call.input])).toEqual([['session.events', { appSessionId: APP, afterSeq: null, limit: null, agentId: AGENT }]]);
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
      ['session.events', { appSessionId: APP, afterSeq: null, limit: null, agentId: AGENT }],
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

  it.each(['completed', 'failed'] as const)('preserves a %s child through a later parent exit, including refreshed snapshots', async (status) => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const done = finish(AGENT, '2026-09-28T10:00:08.000Z', status);
    const exit = builder('2026-09-28T10:00:09.000Z').emit('process.exited', { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0, budget: null }, { id: 'later-exit' });
    const fake = fakeClient();
    const source = childSource(fake);
    const off = source.subscribe(() => {});
    onTestFinished(off);
    const first = source.snapshot();
    answer(fake, 'session.events', { events: [...parent, done], lastSeq: 9, complete: true });
    await flush();
    // The parent exit arrives after provenance was decided but before disk hydration completes.
    fake.emit('session.eventBatch', batch([exit]));
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    expect(rowsOf(applyEvents(createState(null, AGENT), await first)).find((row) => row.kind === 'divider')).toMatchObject({ state: status });
    const refreshed = source.snapshot();
    answer(fake, 'session.events', { events: [...parent, done, exit], lastSeq: 10, complete: true });
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await expect(refreshed).resolves.toEqual([...disk, done]);

    const resumed = { ...parent.find((event) => event.kind === 'subagent.started')!, id: 'resumed' as EventId };
    const stopped = { ...exit, id: 'resumed-exit' as EventId };
    const again = source.snapshot();
    fake.emit('session.eventBatch', batch([resumed, stopped]));
    // A read captured before the resume must not overwrite the new run's exit.
    answer(fake, 'session.events', { events: [...parent, done, exit], lastSeq: 10, complete: true });
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    expect(rowsOf(applyEvents(createState(null, AGENT), await again)).find((row) => row.kind === 'divider')).toMatchObject({ state: 'stopped' });
  });

  it('bounds an incomplete child backfill when an already-errored follower emits no state on retry', async () => {
    vi.useFakeTimers();
    onTestFinished(() => { vi.useRealTimers(); });
    const fake = fakeClient();
    const source = childSource(fake);
    const off = source.subscribe(() => {});
    onTestFinished(off);
    const snapshot = source.snapshot();
    let outcome: unknown = 'pending';
    void snapshot.then(() => { outcome = 'resolved'; }, (error: unknown) => { outcome = error; });
    answer(fake, 'session.events', { events: [], lastSeq: 0, complete: true });
    await vi.advanceTimersByTimeAsync(0);
    answer(fake, 'fs.agentEvents', { events: [], complete: false });
    await vi.advanceTimersByTimeAsync(150_000);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/timed out.*child transcript/i);
    expect(fake.calls.filter((call) => call.name === 'fs.agentEvents')).toHaveLength(1);
    off();
    expect(fake.listeners.get('fs.followState')?.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  // The remote drill-in (2026-11-06): no follow state of another machine's reaches this page (its session's stream carries
  // the journal's events and the panels' notices), so a read of a child there that waits on one, the parent's slice still
  // backfilling or the child's own, is asked again at REMOTE_FOLLOW_POLL_MS instead, under the same bound.
  it('on another machine: a parent read still backfilling and an incomplete child backfill are each asked again with no follow state', async () => {
    vi.useFakeTimers();
    onTestFinished(() => { vi.useRealTimers(); });
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    const { parent, child } = live();
    const disk = onDisk(child);
    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, REMOTE, AGENT);
    const off = source.subscribe(() => {});
    onTestFinished(off);
    const snapshot = source.snapshot();
    answer(fake, 'session.events', { events: [], lastSeq: 0, complete: false });
    await vi.advanceTimersByTimeAsync(REMOTE_FOLLOW_POLL_MS);
    answer(fake, 'session.events', { events: parent.filter((event) => event.kind !== 'subagent.started'), lastSeq: 3, complete: true }); // an earlier launch's child
    await vi.advanceTimersByTimeAsync(0);
    answer(fake, 'fs.agentEvents', { events: [], complete: false });
    await vi.advanceTimersByTimeAsync(REMOTE_FOLLOW_POLL_MS);
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await expect(snapshot).resolves.toEqual(disk);
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events', 'session.events', 'fs.agentEvents', 'fs.agentEvents']);
    expect(vi.getTimerCount()).toBe(0);
  });

  // The remote drill-in: a child of another machine's session is read from the session's stream whenever its launch's
  // slice holds the child's start, its end included (main reads that slice in pages the channel carries, while a disk
  // window crosses as one answer), and from its disk transcript only otherwise; a start heard while it is disk-backed (a
  // resume) is the stream's again, since that machine's disk follow sends nothing here.
  describe('of another machine’s session', () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    const remoteChild = (fake: ReturnType<typeof fakeClient>) => ipcSourceOver(fake.client, REMOTE, AGENT);
    const remoteBatch = (events: SessionEvent[]) => batch(events, REMOTE);

    it('reads a child that ended in the launch from the stream’s slice, its end closing it, with no disk read', async () => {
      const { parent, child } = live();
      const done = finish(AGENT, '2026-09-28T10:00:08.000Z', 'completed');
      const fake = fakeClient();
      const snapshot = remoteChild(fake).snapshot();
      answer(fake, 'session.events', { events: [...parent, ...child, done], lastSeq: 9, complete: true });
      await expect(snapshot).resolves.toEqual([...child, done]);
      expect(fake.calls.map((call) => call.name)).toEqual(['session.events']);
      expect(rowsOf(applyEvents(createState(null, AGENT), [...child, done])).find((row) => row.kind === 'divider')).toMatchObject({ state: 'completed' });
    });

    it('keeps a live child on the stream at its end: the end joins its rows, no reset, no disk read', async () => {
      const { parent, child } = live();
      const done = finish(AGENT, '2026-09-28T10:00:08.000Z', 'completed');
      const fake = fakeClient();
      const source = remoteChild(fake);
      const resets = vi.fn();
      source.onReset!(resets);
      const received: EventId[][] = [];
      const off = source.subscribe((events) => received.push(events.map((event) => event.id)));
      onTestFinished(off);
      const snapshot = source.snapshot();
      answer(fake, 'session.events', { events: [...parent, ...child.slice(0, 2)], lastSeq: 9, complete: true });
      await expect(snapshot).resolves.toEqual(child.slice(0, 2));
      fake.emit('session.eventBatch', remoteBatch([...child.slice(2), done]), OTHER_MACHINE);
      await flush();
      expect(received).toEqual([[...child.slice(2), done].map((event) => event.id)]);
      expect(resets).not.toHaveBeenCalled();
      expect(fake.calls.map((call) => call.name)).toEqual(['session.events']);
    });

    it('takes a disk-backed child back to the stream at a start it hears (a resume): the resumed run’s rows pass', async () => {
      const { parent, child } = live();
      const disk = onDisk(child);
      const fake = fakeClient();
      const source = remoteChild(fake);
      const received: EventId[][] = [];
      const off = source.subscribe((events) => received.push(events.map((event) => event.id)));
      onTestFinished(off);
      const snapshot = source.snapshot();
      answer(fake, 'session.events', { events: parent.filter((event) => event.kind !== 'subagent.started'), lastSeq: 3, complete: true }); // an earlier launch's child
      await flush();
      answer(fake, 'fs.agentEvents', { events: disk, complete: true });
      await expect(snapshot).resolves.toEqual(disk);
      const resumed = { ...parent.find((event) => event.kind === 'subagent.started')!, id: 'resumed' as EventId };
      const run = child.map((event) => ({ ...event, id: `run:${event.id}` as EventId }));
      fake.emit('session.eventBatch', remoteBatch([resumed, ...run]), OTHER_MACHINE);
      await flush();
      expect(received).toEqual([run.map((event) => event.id)]);
    });

    // The second review's three: an end heard only in a batch stays behind that batch's rows; a start heard while the
    // parent's slice was on its way decides as the slice would had it held it; and a gap in the stream reads it again.
    const REMOTE_KEY = `${REMOTE}:${AGENT}`;
    it('leaves an end the snapshot’s slice did not hold behind the rows of the batch that carried it: one turn, completed', async () => {
      const { parent, child } = live();
      const done = finish(AGENT, '2026-09-28T10:00:08.000Z', 'completed');
      const fake = fakeClient();
      const hydrated = useTranscriptStore.getState().attach(REMOTE_KEY, remoteChild(fake), { agentId: AGENT });
      fake.emit('session.eventBatch', remoteBatch([...child.slice(1), done]), OTHER_MACHINE); // held: the slice is on its way
      answer(fake, 'session.events', { events: [...parent, child[0]], lastSeq: 9, complete: true });
      await hydrated;
      const dividers = useTranscriptStore.getState().rows(REMOTE_KEY).filter((row) => row.kind === 'divider');
      expect(dividers.map((row) => (row as Extract<Row, { kind: 'divider' }>).state)).toEqual(['completed']);
      useTranscriptStore.getState().detach(REMOTE_KEY);
    });

    it('takes a start held while the first slice was on its way as the stream’s: no disk read, the resumed rows pass', async () => {
      const { parent, child } = live();
      const fake = fakeClient();
      const hydrated = useTranscriptStore.getState().attach(REMOTE_KEY, remoteChild(fake), { agentId: AGENT });
      const resumed = { ...parent.find((event) => event.kind === 'subagent.started')!, id: 'resumed' as EventId };
      fake.emit('session.eventBatch', remoteBatch([resumed, ...child]), OTHER_MACHINE);
      answer(fake, 'session.events', { events: parent.filter((event) => event.kind !== 'subagent.started'), lastSeq: 3, complete: true });
      await hydrated;
      await flush();
      expect(fake.calls.map((call) => call.name)).toEqual(['session.events']);
      expect(useTranscriptStore.getState().entries[REMOTE_KEY].phase).toBe('live');
      expect([...useTranscriptStore.getState().entries[REMOTE_KEY].state.seen]).toEqual(child.map((event) => event.id));
      useTranscriptStore.getState().detach(REMOTE_KEY);
    });

    // The third review: the liveness the held batches show outlives an empty first slice (E11's host loss reads it).
    it('keeps the liveness its held batches showed past an empty first slice: a host lost then ends the child as stopped', async () => {
      const { parent, child } = live();
      const fake = fakeClient();
      const hydrated = useTranscriptStore.getState().attach(REMOTE_KEY, remoteChild(fake), { agentId: AGENT });
      const started = parent.find((event) => event.kind === 'subagent.started')!;
      fake.emit('session.eventBatch', remoteBatch([started, ...child.slice(0, 2)]), OTHER_MACHINE); // held: the slice is on its way
      answer(fake, 'session.events', { events: [], lastSeq: 0, complete: true }); // read before the child started
      await hydrated;
      await flush();
      expect(dividerOf(REMOTE_KEY).state).toBe('working');
      fake.emit('engine.hostState', { state: 'restarting' } as never, OTHER_MACHINE);
      fake.emit('engine.hostState', { state: 'ready' } as never, OTHER_MACHINE);
      answer(fake, 'engine.sessions', []);
      await flush();
      answer(fake, 'host.supervisorStatus', { pid: 1 }); // no session hosts: its table stands
      await flush();
      expect(dividerOf(REMOTE_KEY)).toMatchObject({ state: 'stopped', cause: 'crash' });
      useTranscriptStore.getState().detach(REMOTE_KEY);
    });

    it('keeps a disk-backed child that resumes while its slice is read again on the stream, whatever that older slice holds', async () => {
      const { parent, child } = live();
      const disk = onDisk(child);
      const fake = fakeClient();
      const source = remoteChild(fake);
      const received: EventId[][] = [];
      const off = source.subscribe((events) => received.push(events.map((event) => event.id)));
      onTestFinished(off);
      const earlier = parent.filter((event) => event.kind !== 'subagent.started'); // an earlier launch's child
      const first = source.snapshot();
      answer(fake, 'session.events', { events: earlier, lastSeq: 3, complete: true });
      await flush();
      answer(fake, 'fs.agentEvents', { events: disk, complete: true });
      await first;
      const again = source.snapshot(); // a Retry: its slice is read before the resume below
      const resumed = { ...parent.find((event) => event.kind === 'subagent.started')!, id: 'resumed' as EventId };
      const run = child.map((event) => ({ ...event, id: `run:${event.id}` as EventId }));
      fake.emit('session.eventBatch', remoteBatch([resumed, run[0]]), OTHER_MACHINE);
      answer(fake, 'session.events', { events: earlier, lastSeq: 3, complete: true });
      await again;
      fake.emit('session.eventBatch', remoteBatch(run.slice(1)), OTHER_MACHINE);
      await flush();
      expect(fake.calls.filter((call) => call.name === 'fs.agentEvents')).toHaveLength(1);
      expect(received.flat()).toEqual(run.map((event) => event.id));
    });

    it('reads a child the stream carries again at a gap in the session’s stream; a disk-backed one, not', async () => {
      const { parent, child } = live();
      const fake = fakeClient();
      const source = remoteChild(fake);
      const resets = vi.fn();
      source.onReset!(resets);
      const off = source.subscribe(() => {});
      onTestFinished(off);
      const snapshot = source.snapshot();
      answer(fake, 'session.events', { events: [...parent, child[0]], lastSeq: 9, complete: true });
      await snapshot;
      fake.emit('remote.gap', { appSessionId: addressOf(OTHER_MACHINE, 'app-other' as AppSessionId), launchId: 'L1' }, OTHER_MACHINE);
      await flush();
      expect(resets).not.toHaveBeenCalled();
      fake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1' }, OTHER_MACHINE);
      await flush();
      expect(resets).toHaveBeenCalledTimes(1);

      const diskFake = fakeClient();
      const diskSource = ipcSourceOver(diskFake.client, REMOTE, AGENT);
      const diskResets = vi.fn();
      diskSource.onReset!(diskResets);
      const offDisk = diskSource.subscribe(() => {});
      onTestFinished(offDisk);
      const read = diskSource.snapshot();
      answer(diskFake, 'session.events', { events: parent.filter((event) => event.kind !== 'subagent.started'), lastSeq: 3, complete: true });
      await flush();
      answer(diskFake, 'fs.agentEvents', { events: onDisk(child), complete: true });
      await read;
      diskFake.emit('remote.gap', { appSessionId: REMOTE, launchId: 'L1' }, OTHER_MACHINE);
      await flush();
      expect(diskResets).not.toHaveBeenCalled();
    });
  });

  it('waits for an incomplete empty child backfill before applying the parent completion', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const done = finish(AGENT, '2026-09-28T10:00:09.000Z', 'completed');
    const fake = fakeClient();
    const hydrated = useTranscriptStore.getState().attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: [...parent, done], lastSeq: 9, complete: true });
    await flush();
    answer(fake, 'fs.agentEvents', { events: [], complete: false });
    await flush();
    expect(useTranscriptStore.getState().entries[CHILD_KEY].phase).toBe('hydrating');
    fake.emit('session.eventBatch', batch(disk));
    fake.emit('fs.followState', followState('following'));
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await hydrated;
    expect(dividerOf(CHILD_KEY).state).toBe('completed');
    expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual([...disk, done].map((e) => e.id));
  });

  it('reads its parent again once the parent\'s follow has read through, and decides its lifecycle from that, not from an empty page', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const done = finish(AGENT, '2026-09-28T10:00:09.000Z', 'completed');
    const fake = fakeClient();
    const hydrated = useTranscriptStore.getState().attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: [], lastSeq: 0, complete: false }); // the parent's follow still reads its transcript through
    await flush();
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events']);
    fake.emit('fs.followState', { ...followState('following'), agentId: null });
    await flush();
    answer(fake, 'session.events', { events: [...parent, done].map((e) => ({ ...e, seq: null })), lastSeq: 0, complete: true });
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await hydrated;
    expect(dividerOf(CHILD_KEY).state).toBe('completed');
    useTranscriptStore.getState().detach(CHILD_KEY);

    // Detached while it waits: it stops, asking nothing more and listening to nothing.
    const again = fakeClient();
    const reading = useTranscriptStore.getState().attach(CHILD_KEY, childSource(again), { agentId: AGENT });
    answer(again, 'session.events', { events: [], lastSeq: 0, complete: false });
    await flush();
    useTranscriptStore.getState().detach(CHILD_KEY);
    await reading;
    expect(again.calls.map((call) => call.name)).toEqual(['session.events']);
    expect(again.listeners.get('fs.followState')?.size ?? 0).toBe(0);
  });

  it('holds the disk follow\'s batches until fs.agentEvents answers, and drops what they carry from before its window', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const fake = fakeClient();
    const source = childSource(fake);
    const hydrated = useTranscriptStore.getState().attach(CHILD_KEY, source, { agentId: AGENT });
    answer(fake, 'session.events', { events: parent.map((e) => ({ ...e, seq: null })), lastSeq: 0, complete: true }); // a disk-backed parent
    await flush();
    answer(fake, 'fs.agentEvents', { events: [], complete: false }); // the child's follow still reads it through
    await flush();
    fake.emit('session.eventBatch', batch(disk.slice(0, 2))); // its window once read through
    fake.emit('fs.followState', followState('following'));
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk.slice(1), complete: true, earlier: disk[1].id }); // appends moved the window on
    await hydrated;
    expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual(disk.slice(1).map((e) => e.id));
    source.older!.loadOlder();
    answer(fake, 'fs.agentEvents', { events: disk.slice(0, 1), complete: true });
    await vi.waitFor(() => expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual(disk.map((e) => e.id)));
    useTranscriptStore.getState().detach(CHILD_KEY);
  });

  it('a jump into a disk child\'s older history asks fs.agentEvents for the pages back to the message, and lands on it', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const fake = fakeClient();
    const hydrated = useTranscriptStore.getState().attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: parent.map((e) => ({ ...e, seq: null })), lastSeq: 0, complete: true });
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk.slice(1), complete: true, earlier: disk[1].id }); // its newest window
    await hydrated;
    const target = { messageUuid: uuid('c1-u0'), blockIndex: 0 }; // the child's first words, before the window
    expect(disk[0]).toMatchObject({ messageUuid: target.messageUuid });
    const reaching = useTranscriptStore.getState().reachMessage(CHILD_KEY, target);
    await flush();
    expect(fake.calls.at(-1)).toMatchObject({ name: 'fs.agentEvents', input: { appSessionId: APP, agentId: AGENT, before: disk[1].id, seek: target.messageUuid } });
    answer(fake, 'fs.agentEvents', { events: disk.slice(0, 1), complete: true, sought: { at: 'page', behind: 0 } });
    expect(await reaching).toBe('landed');
    const entry = useTranscriptStore.getState().entries[CHILD_KEY]!;
    expect(entry.rows.find((row) => row.id === entry.jump?.rowId)).toMatchObject({ kind: 'assistant_text', messageUuid: target.messageUuid });
    useTranscriptStore.getState().detach(CHILD_KEY);
  });

  it('a released follow is no reset: the child is read again at the next change of its session\'s record', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const fake = fakeClient();
    const history = { events: parent.map((e) => ({ ...e, seq: null })), lastSeq: 0, complete: true };
    const hydrated = useTranscriptStore.getState().attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', history);
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk.slice(0, 2), complete: true });
    await hydrated;
    fake.emit('fs.followState', { ...followState('stopped'), message: FOLLOW_RELEASED });
    await flush();
    expect(fake.calls).toHaveLength(2); // following again at once would only be released again
    fake.emit('session.changed', { record: { appId: APP, holder: { kind: 'terminal', pid: 7 } }, cause: 'live', revision: 1 } as never);
    await flush();
    answer(fake, 'session.events', history);
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await vi.waitFor(() => expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual(disk.map((e) => e.id)));
    expect(useTranscriptStore.getState().entries[CHILD_KEY].phase).toBe('live');
    useTranscriptStore.getState().detach(CHILD_KEY);
  });

  it('reacquires a mounted disk child after both parent relaunch unfollows, including a late index stop', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const fake = fakeClient();
    const hydrated = useTranscriptStore.getState().attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    const history = { events: parent.map((e) => ({ ...e, seq: null })), lastSeq: 0, complete: true };
    answer(fake, 'session.events', history);
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk.slice(0, 2), complete: true });
    await hydrated;
    // Resume stops all followers; no other child consumer restarts this one.
    fake.emit('fs.followState', followState('stopped'));
    await flush();
    expect(fake.calls.filter((c) => c.name === 'session.events')).toHaveLength(2);
    answer(fake, 'session.events', history);
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk.slice(0, 3), complete: true });
    await flush();
    fake.emit('session.eventBatch', batch([...child.slice(3), ...disk.slice(3)]));
    expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual(disk.map((e) => e.id));
    // The index's separately queued unfollow arrives after the first re-acquisition.
    fake.emit('fs.followState', followState('stopped'));
    await flush();
    answer(fake, 'session.events', history);
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await flush();
    expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual(disk.map((e) => e.id));
    fake.emit('fs.followState', { ...followState('stopped'), agentId: null });
    fake.emit('fs.followState', { ...followState('stopped'), appSessionId: at('another' as AppSessionId) });
    await flush();
    expect(fake.calls.filter((c) => c.name === 'fs.agentEvents')).toHaveLength(3);
    useTranscriptStore.getState().detach(CHILD_KEY);
    expect(fake.listeners.get('fs.followState')?.size).toBe(0);
  });

  it('refreshes a disk child completion after an unobserved same-agent resume', async () => {
    // pass3/relay-to-child.jsonl seq 517 task_notification, seq 548 task_started: the same task id resumes.
    const { parent, child } = live();
    const disk = onDisk(child);
    const done = finish(AGENT, '2026-09-28T10:00:09.000Z', 'completed');
    const fake = fakeClient();
    const source = childSource(fake);
    const first = source.snapshot();
    answer(fake, 'session.events', { events: [...parent, done], lastSeq: 517, complete: true });
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await expect(first).resolves.toEqual([...disk, done]);
    const resumed = { ...parent.find((e) => e.kind === 'subagent.started')!, id: 'resumed' as EventId, seq: 548 };
    const second = source.snapshot();
    expect(fake.calls.at(-1)?.name).toBe('session.events');
    answer(fake, 'session.events', { events: [...parent, done, resumed], lastSeq: 548, complete: true });
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    const events = await second;
    expect(events).toEqual(disk);
    const state = applyEvents(createState(null, AGENT), events);
    expect(rowsOf(state).find((row) => row.kind === 'divider')).toMatchObject({ state: 'working' });
  });

  it('does not restore an old completion when a same-agent start arrives during the parent read', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const done = finish(AGENT, '2026-09-28T10:00:09.000Z', 'completed');
    const fake = fakeClient();
    const source = childSource(fake);
    const off = source.subscribe(() => {});
    const history = { events: [...parent, done], lastSeq: 517, complete: true };
    const first = source.snapshot();
    answer(fake, 'session.events', history);
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await first;
    const second = source.snapshot();
    fake.emit('session.eventBatch', batch([{ ...parent.find((e) => e.kind === 'subagent.started')!, id: 'resumed' as EventId, seq: 548 }]));
    answer(fake, 'session.events', history); // the response was captured before the new start
    await flush();
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await expect(second).resolves.toEqual(disk);
    off();
  });

  it.each(['parent', 'disk'] as const)('a same-agent start heard during the %s read clears an old completion before the disk answer is joined with it', async (during) => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const done = finish(AGENT, '2026-09-28T10:00:09.000Z', 'completed');
    const resumed = { ...parent.find((e) => e.kind === 'subagent.started')!, id: 'resumed' as EventId, seq: 548 };
    const fake = fakeClient();
    const hydrated = useTranscriptStore.getState().attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    if (during === 'parent') fake.emit('session.eventBatch', batch([resumed]));
    answer(fake, 'session.events', { events: [...parent, done], lastSeq: 517, complete: true });
    await flush();
    if (during === 'disk') fake.emit('session.eventBatch', batch([resumed])); // the agent resumes while fs.agentEvents is on its way
    answer(fake, 'fs.agentEvents', { events: disk, complete: true });
    await hydrated;
    expect([...useTranscriptStore.getState().entries[CHILD_KEY].state.seen]).toEqual(disk.map((e) => e.id));
    expect(dividerOf(CHILD_KEY).state).toBe('working');
    useTranscriptStore.getState().detach(CHILD_KEY);
  });

  it('stops requesting incomplete backfill when its attachment is detached', async () => {
    const fake = fakeClient();
    const source = childSource(fake);
    const off = source.subscribe(() => {});
    const snapshot = source.snapshot();
    answer(fake, 'session.events', { events: [], lastSeq: 0, complete: true });
    await flush();
    answer(fake, 'fs.agentEvents', { events: [], complete: false });
    await flush();
    off();
    await expect(snapshot).resolves.toEqual([]);
    expect(fake.calls.filter((c) => c.name === 'fs.agentEvents')).toHaveLength(1);
    expect(fake.listeners.get('fs.followState')?.size).toBe(0);
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
    answer(fake, 'session.events', { events: [...parent, ...child, finished], lastSeq: 10, complete: true });
    await flush();
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events', 'session.events', 'fs.agentEvents']); // reset refreshes lifecycle too
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
    expect(subscriptions(fake)).toBe(1);
    expect(useTranscriptStore.getState().rows(CHILD_KEY)).toBe(rows);
    store.detach(CHILD_KEY); // the tab closes; the drill-in still follows
    fake.emit('session.eventBatch', batch(child.slice(2)));
    expect(useTranscriptStore.getState().entries[CHILD_KEY].state.seen.has(child.at(-1)!.id)).toBe(true);
    store.detach(CHILD_KEY);
    expect(subscriptions(fake)).toBe(0);
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
    expect(subscriptions(fake)).toBe(1);
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
    expect(subscriptions(fake)).toBe(0);
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
    const exit = builder('2026-09-28T10:00:09.000Z').emit('process.exited', { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0, budget: null /* C12 */ }, { id: 'exit' });
    fake.emit('session.eventBatch', batch([child[3], exit]));
    expect(dividerOf(CHILD_KEY).state).toBe('stopped'); // in the live state, before the reset
    await Promise.resolve(); // the reset follows the batch that carried the end
    expect(useTranscriptStore.getState().entries[CHILD_KEY]).toMatchObject({ phase: 'hydrating' });
    expect(useTranscriptStore.getState().rows(CHILD_KEY)).toEqual([]); // the live id form is gone
    answer(fake, 'session.events', { events: [...parent, exit], lastSeq: 10, complete: true });
    await flush();
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events', 'session.events', 'fs.agentEvents']);
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
    const exit = builder('2026-09-28T10:00:09.000Z').emit('process.exited', { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0, budget: null /* C12 */ }, { id: 'exit' });
    fake.emit('session.eventBatch', batch([exit]));
    await Promise.resolve(); // reset: now hydrating from disk
    answer(fake, 'session.events', { events: [...parent, exit], lastSeq: 10, complete: true });
    await flush();
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
    const exit = builder('2026-09-28T10:00:09.000Z').emit('process.exited', { code: null, signal: 'SIGKILL', reason: 'crash', lostAttentionCount: 0, budget: null /* C12 */ }, { id: 'crash' });
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
    const earlier = builder('2026-09-28T09:59:00.000Z').emit('process.exited', { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0, budget: null /* C12 */ }, { id: 'earlier' });
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
    fake.emit('session.eventBatch', batch([builder('2026-09-28T10:00:09.000Z').emit('process.exited', { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0, budget: null /* C12 */ }, { id: 'later' })]));
    await flush();
    expect(resets).toHaveBeenCalledTimes(1);
    store.detach(CHILD_KEY);
  });

  it('an exit before the child started is no end of it: a child started after a relaunch is live', async () => {
    const { parent, child } = live();
    const exit = builder('2026-09-28T09:59:00.000Z').emit('process.exited', { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0, budget: null /* C12 */ }, { id: 'earlier' });
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
      answer(fake, 'session.events', { events: [...parent, ...ending(AGENT, '2026-09-28T10:00:11.000Z')], lastSeq: 10, complete: true });
      await flush();
      expect(fake.calls.at(-1)?.name).toBe('fs.agentEvents'); // disk provenance, refreshed lifecycle
      answer(fake, 'fs.agentEvents', { events: onDisk(child), complete: true });
      await again;
    }
  });

  // E11 (W-C), beside the session source's host-loss case below (E10): a host that dies sends no exit for the parent, so
  // the live child hears the same loss and ends as stopped, and the disk re-read the switch starts shows it stopped too,
  // though the successor's parent read holds no exit.
  it('a live child whose host died ends as stopped when the successor does not list the parent, live and after the reset to disk', async () => {
    const { parent, child } = live();
    const disk = onDisk(child);
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: [...parent, ...child.slice(0, 3)], lastSeq: 9, complete: true });
    await hydrated;
    expect(dividerOf(CHILD_KEY).state).toBe('working');

    const seen: { phase: string; divider: Row | undefined }[] = []; // the live state between the exit and the reset
    const off = useTranscriptStore.subscribe((state) => {
      const entry = state.entries[CHILD_KEY];
      if (entry) seen.push({ phase: entry.phase, divider: entry.rows.find((row) => row.kind === 'divider') });
    });
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    answer(fake, 'engine.sessions', [{ appSessionId: at('other' as AppSessionId) }]);
    await flush();
    off();
    expect(seen[0]).toMatchObject({ phase: 'live', divider: { state: 'stopped', cause: 'crash' } }); // in the live state, before the reset
    expect(useTranscriptStore.getState().entries[CHILD_KEY]).toMatchObject({ phase: 'hydrating' });

    answer(fake, 'session.events', { events: parent, lastSeq: 9, complete: true }); // the successor's read: no exit
    await flush();
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events', 'engine.sessions', 'session.events', 'fs.agentEvents']);
    answer(fake, 'fs.agentEvents', { events: disk.slice(0, 3), complete: true });
    await flush();
    const entry = useTranscriptStore.getState().entries[CHILD_KEY];
    expect(entry.phase).toBe('live');
    expect(dividerOf(CHILD_KEY)).toMatchObject({ state: 'stopped', cause: 'crash' }); // and again in the disk state
    expect(entry.working).toBe(false);
    store.detach(CHILD_KEY);
  });

  it('a host that still lists the parent speaks for the live child: it keeps working, and a child already on disk is not asked about', async () => {
    const { parent, child } = live();
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(CHILD_KEY, childSource(fake), { agentId: AGENT });
    answer(fake, 'session.events', { events: [...parent, ...child.slice(0, 2)], lastSeq: 9, complete: true });
    await hydrated;
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    answer(fake, 'engine.sessions', [{ appSessionId: APP }]);
    await flush();
    expect(dividerOf(CHILD_KEY).state).toBe('working');
    store.detach(CHILD_KEY);

    const second = fakeClient();
    const onDiskChild = store.attach(CHILD_KEY, ipcSourceOver(second.client, APP, AGENT), { agentId: AGENT });
    answer(second, 'session.events', { events: [], lastSeq: 0, complete: true }); // a disk-backed parent
    await flush();
    answer(second, 'fs.agentEvents', { events: onDisk(child).slice(0, 2), complete: true });
    await onDiskChild;
    second.emit('engine.hostState', { state: 'restarting' } as never);
    second.emit('engine.hostState', { state: 'ready' } as never);
    await flush();
    expect(second.calls.map((call) => call.name)).toEqual(['session.events', 'fs.agentEvents']);
    store.detach(CHILD_KEY);
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

// P5 O7 M3: a link out of another machine's session that is not a forward opens through main told that machine, so main
// refuses a loopback link of it (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Forwarding", main's backstop)
describe('default openExternal', () => {
  it('opens through layout.openExternal, told the machine of a row session on another machine', () => {
    const fake = fakeClient();
    const open = ipcOpenExternalOver(fake.client);
    open('https://example.com/a');
    open('https://example.com/b', at('session-l' as AppSessionId));
    open('https://example.com/c', addressOf(OTHER_MACHINE, 'session-r' as AppSessionId));
    expect(fake.calls.map(({ name, input, machine }) => [name, input, machine])).toEqual([
      ['layout.openExternal', { url: 'https://example.com/a' }, undefined],
      ['layout.openExternal', { url: 'https://example.com/b' }, undefined],
      ['layout.openExternal', { url: 'https://example.com/c' }, OTHER_MACHINE],
    ]);
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
    expect('reapply' in rewind).toBe(false);

    const check = rewind.canUndo(turnId.ofMessage(uuid('u1')));
    expect(fake.calls[0].input).toEqual({ appSessionId: APP, userMessageUuid: 'u1', dryRun: true });
    fake.calls[0].answer({ ok: true, value: OUTCOME });
    await expect(check).resolves.toEqual({ ok: true, reason: null, files: OUTCOME.changedFiles });

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
    await expect(failed).resolves.toEqual({ ok: false, reason: 'No file checkpoint found for this message.', files: OUTCOME.changedFiles });

    const down = rewind.canUndo(u1);
    fake.calls[2].answer({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is not running' } });
    await expect(down).resolves.toEqual({ ok: false, reason: 'engine-host is not running' });

    await expect(rewind.canUndo(state.order[1])).resolves.toEqual({ ok: false, reason: 'This turn has no prompt to rewind to' });
    expect(fake.calls).toHaveLength(3);

    const undo = rewind.undo(u1);
    fake.calls[3].answer({ ok: true, value: { ...OUTCOME, ok: false, message: 'Rewind failed: file changed on disk' } });
    await expect(undo).rejects.toThrow('Rewind failed: file changed on disk');
  });

  // UX wave U4a (the architect's ruling 3 of 2026-11-13; decision 32): the messages the engine joins are one user
  // message in its file, under the last one's uuid, standing where the first stood; the turn it opens rewinds by that
  // uuid, the one the file holds. A turn with no join, and an engine turn, answer as before.
  describe('after the engine joined waiting messages', () => {
    const prompts = (name: string) => loadUxwaveJournal(name).flatMap((row) => (row.direction === 'out' && (row.frame as { type?: string }).type === 'user' ? [(row.frame as { uuid: MessageUuid }).uuid] : []));
    const stateThrough = (name: string, seq: number) => applyEvents(createState(null, null), journalToEvents(loadUxwaveJournal(name).filter((row) => row.seq <= seq)));

    for (const [name, joinedAt] of [['u4p2-two-1-1', 60], ['u4p2-two-2-1', 87]] as const) {
      it(`${name}: the joined turn's dry run and its undo name the joined message's uuid; the turn before it, its own prompt`, async () => {
        const [ran, first, second] = prompts(name) as [MessageUuid, MessageUuid, MessageUuid];
        const state = stateThrough(name, joinedAt);
        const joined = state.turns.get(turnId.ofMessage(first))!.events.find((event) => event.kind === 'user.message' && event.joined !== undefined);
        expect(joined).toMatchObject({ messageUuid: second, joined: [first] }); // the reducer did join them
        const fake = fakeClient();
        const rewind = ipcRewindOver(fake.client, APP, () => state);

        const check = rewind.canUndo(turnId.ofMessage(first));
        expect(fake.calls[0].input).toEqual({ appSessionId: APP, userMessageUuid: second, dryRun: true });
        fake.calls[0].answer({ ok: true, value: OUTCOME });
        await expect(check).resolves.toEqual({ ok: true, reason: null, files: OUTCOME.changedFiles });
        const undo = rewind.undo(turnId.ofMessage(first));
        expect(fake.calls[1].input).toEqual({ appSessionId: APP, userMessageUuid: second, dryRun: false });
        fake.calls[1].answer({ ok: true, value: OUTCOME });
        await expect(undo).resolves.toBeUndefined();

        void rewind.canUndo(turnId.ofMessage(ran)); // no join: its own prompt, as before
        expect(fake.calls[2].input).toEqual({ appSessionId: APP, userMessageUuid: ran, dryRun: true });
      });
    }

    it('before the join the first message’s turn answers its own uuid; an engine-initiated turn still has no prompt', async () => {
      const [, first] = prompts('u4p2-two-1-1') as [MessageUuid, MessageUuid];
      const before = stateThrough('u4p2-two-1-1', 55);
      const fake = fakeClient();
      void ipcRewindOver(fake.client, APP, () => before).canUndo(turnId.ofMessage(first));
      expect(fake.calls[0].input).toEqual({ appSessionId: APP, userMessageUuid: first, dryRun: true });
      const engine = turns();
      await expect(ipcRewindOver(fake.client, APP, () => engine).canUndo(engine.order[1]!)).resolves.toEqual({ ok: false, reason: 'This turn has no prompt to rewind to' });
      expect(fake.calls).toHaveLength(1);
    });
  });
});

// W7 (charter §4.3 as amended 2026-10-01): once MAWS's process has exited and a foreign process holds the session, the
// pane follows the transcript the other process writes, not the stream that stopped.
describe('ipcSource after MAWS yields to a foreign holder (W7)', () => {
  it('resets once when the record turns foreign-live after the live form, and the new hydration follows disk', async () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'MAWS wrote this.');
    b.end(['u1']);
    const mine = b.events.length;
    const liveForm = b.events.map((event, i) => ({ ...event, id: `${MAIN_APP}:launch-1:${i + 1}:0` as EventId, seq: i + 1 }));
    b.turn('t1');
    b.text('m2', 0, 'The terminal wrote this.');
    b.end(['t1']);
    const diskForm = b.events.map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null }));
    const changed = (holder: unknown) => ({ record: { appId: APP, holder }, cause: 'live', revision: 1 }) as never;

    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, APP);
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(source.key!, source);
    fake.calls[0].answer({ ok: true, value: { events: liveForm, lastSeq: liveForm.length, complete: true } } as never);
    await hydrated;
    fake.emit('session.changed', changed({ kind: 'self', contestedBy: { kind: 'terminal', pid: 7 } })); // contested: still live
    fake.emit('session.changed', changed({ kind: 'terminal', pid: 7 })); // the process exited; the terminal holds it
    await vi.waitFor(() => expect(fake.calls).toHaveLength(2));
    expect(fake.calls[1].name).toBe('session.events');
    fake.calls[1].answer({ ok: true, value: { events: diskForm.slice(0, mine), lastSeq: 0, complete: true } } as never);
    await vi.waitFor(() => expect(useTranscriptStore.getState().entries[APP]?.phase).toBe('live'));
    fake.emit('session.eventBatch', batch(diskForm.slice(mine))); // the terminal's turn, from the follower
    expect([...useTranscriptStore.getState().entries[APP].state.seen]).toEqual(diskForm.map((event) => event.id));
    // a later change while following disk is no second reset
    fake.emit('session.changed', changed({ kind: 'terminal', pid: 7 }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.calls).toHaveLength(2);
    store.detach(source.key!);
  });

  // review finding: the custody change can arrive while the first snapshot is still on its way with the old journal
  it('remembers a turn to foreign-live heard while the snapshot is pending, and resets once the snapshot is live', async () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'MAWS wrote this.');
    b.end(['u1']);
    const liveForm = b.events.map((event, i) => ({ ...event, id: `${MAIN_APP}:launch-1:${i + 1}:0` as EventId, seq: i + 1 }));
    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, APP);
    const store = useTranscriptStore.getState();
    const hydrated = store.attach(source.key!, source);
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    fake.emit('session.changed', { record: { appId: APP, holder: { kind: 'terminal', pid: 7 } }, cause: 'live', revision: 1 } as never);
    fake.calls[0].answer({ ok: true, value: { events: liveForm, lastSeq: liveForm.length, complete: true } } as never);
    await hydrated;
    await vi.waitFor(() => expect(fake.calls).toHaveLength(2)); // the reset's hydration asks again
    expect(fake.calls[1].name).toBe('session.events');
    store.detach(source.key!);
  });
});

// The long-transcript window (docs/doperpowers/plans/2026-10-30-long-transcript-window.md): a disk-backed session's
// snapshot is one window of its history with an `earlier` cursor, and older pages rebuild the key from the pager's log.
describe('ipcSource over a long transcript\'s window', () => {
  // Five turns as a disk follow delivers them (`seq: null`): turn n is events 4(n-1) to 4n-1.
  const disk = (() => {
    const b = builder();
    for (const n of [1, 2, 3, 4, 5]) {
      b.turn(`u${n}`);
      b.text(`m${n}`, 0, `Answer ${n}`);
      b.end([`u${n}`]);
    }
    return b.events.map((event) => ({ ...event, seq: null }) as SessionEvent);
  })();
  const turns = (from: number, to: number) => disk.slice(4 * (from - 1), 4 * to);
  const page = (events: SessionEvent[], older = false) => ({ ok: true, value: { events, lastSeq: 0, complete: true, ...(older && { earlier: events[0]!.id }) } }) as never;
  const ids = (events: SessionEvent[]) => events.map((event) => event.id);
  const seen = () => [...useTranscriptStore.getState().entries[APP]!.state.seen];
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('drops what a held batch carries from before the window the snapshot answered, and the older page brings it back in order', async () => {
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const source = ipcSourceOver(fake.client, APP);
    const hydrated = store.attach(APP, source);
    fake.calls[0].answer({ ok: true, value: { events: [], lastSeq: 0, complete: false } } as never); // the host still reads it through
    await vi.waitFor(() => expect(fake.listeners.get('fs.followState')?.size ?? 0).toBeGreaterThan(0));
    fake.emit('session.eventBatch', batch(turns(1, 2))); // its window once read through, held while the snapshot is on its way
    await vi.waitFor(() => expect(fake.calls).toHaveLength(2)); // the batch wakes the read
    fake.calls[1].answer(page(turns(2, 3), true)); // turn 3 appended meanwhile moved the window on
    await hydrated;
    expect(seen()).toEqual(ids(turns(2, 3))); // turn 1 never lands after turn 3
    source.older!.loadOlder();
    expect(fake.calls[2].input).toMatchObject({ before: turns(2, 2)[0]!.id });
    fake.calls[2].answer(page(turns(1, 1)));
    await vi.waitFor(() => expect(seen()).toEqual(ids(turns(1, 3))));
    store.detach(APP);
  });

  it('reads a session whose follow was released again at the next change of its record, keeping what the reader opened', async () => {
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const source = ipcSourceOver(fake.client, APP);
    const hydrated = store.attach(APP, source);
    fake.calls[0].answer(page(turns(1, 2)));
    await hydrated;
    const opened = turnId.ofMessage(uuid('u1'));
    store.toggleTurn(APP, opened); // the reader opens a closed turn
    const stopped = (message: string | null): EventPayload<'fs.followState'> => ({ appSessionId: APP, agentId: null, state: 'stopped', chainLength: 0, leafUuid: null, gap: null, skippedLines: 0, message });
    const changed = { record: { appId: APP, holder: { kind: 'terminal', pid: 7 } }, cause: 'live', revision: 1 } as never;
    fake.emit('fs.followState', stopped(null)); // a plain stop (a resume's handoff to the live stream) is no release
    fake.emit('session.changed', changed);
    await flush();
    expect(fake.calls).toHaveLength(1);
    fake.emit('fs.followState', stopped(FOLLOW_RELEASED)); // out of every client's interest while still mounted
    await flush();
    expect(fake.calls).toHaveLength(1);
    fake.emit('session.changed', changed); // a terminal wrote to it
    await vi.waitFor(() => expect(fake.calls).toHaveLength(2));
    expect(fake.calls[1].input).toEqual({ appSessionId: APP, afterSeq: null, limit: null });
    fake.calls[1].answer(page(turns(1, 3)));
    await vi.waitFor(() => expect(seen()).toEqual(ids(turns(1, 3))));
    expect(useTranscriptStore.getState().entries[APP]!.state.ui.expandedTurns.has(opened)).toBe(true);
    fake.emit('session.changed', changed); // once: following again, the source reads nothing more
    await flush();
    expect(fake.calls).toHaveLength(2);
    store.detach(APP);
  });

  it('a released session read again lets go of an older page still on its way, which would rebuild the old history over it', async () => {
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const source = ipcSourceOver(fake.client, APP);
    const hydrated = store.attach(APP, source);
    fake.calls[0].answer(page(turns(2, 3), true));
    await hydrated;
    source.older!.loadOlder(); // the reader reached the top: the page before turn 2 is on its way
    expect(fake.calls[1].input).toMatchObject({ before: turns(2, 2)[0]!.id });
    fake.emit('fs.followState', { appSessionId: APP, agentId: null, state: 'stopped', chainLength: 0, leafUuid: null, gap: null, skippedLines: 0, message: FOLLOW_RELEASED });
    fake.emit('session.changed', { record: { appId: APP, holder: { kind: 'terminal', pid: 7 } }, cause: 'live', revision: 1 } as never);
    await vi.waitFor(() => expect(fake.calls).toHaveLength(3)); // the session read again
    expect(source.older!.state.getState()).toMatchObject({ loadingOlder: false, more: false });
    fake.calls[1].answer(page(turns(1, 1))); // the stale page finishes first
    await flush();
    fake.calls[2].answer(page(turns(2, 4), true)); // the terminal wrote turn 4
    await vi.waitFor(() => expect(seen()).toEqual(ids(turns(2, 4))));
    expect(source.older!.state.getState().more).toBe(true);
    store.detach(APP);
  });

  it('a snapshot whose subscription was superseded leaves the pager to the current one, so an older page keeps what is shown', async () => {
    const fake = fakeClient();
    const store = useTranscriptStore.getState();
    const source = ipcSourceOver(fake.client, APP);
    const first = store.attach(APP, source);
    store.detach(APP); // closed and opened again while the first read is on its way
    const second = store.attach(APP, source);
    fake.calls[1].answer(page(turns(3, 4), true));
    await second;
    fake.emit('session.eventBatch', batch(turns(5, 5))); // appended after the current window
    fake.calls[0].answer(page(turns(2, 3), true)); // the obsolete read, an older window, finishes last
    await first;
    expect(seen()).toEqual(ids(turns(3, 5)));
    source.older!.loadOlder();
    expect(fake.calls[2].input).toMatchObject({ before: turns(3, 3)[0]!.id }); // the current window's cursor
    fake.calls[2].answer(page(turns(1, 2)));
    await vi.waitFor(() => expect(seen()).toEqual(ids(disk)));
    store.detach(APP);
  });
});

// E10 (Task 4.1's crash screenshot): a host that dies takes its engine processes along and sends no exit for them, and
// a successor that never ran the session never will. The session's source closes what its live stream left running.
describe('ipcSource after the engine host is lost (E10)', () => {
  const liveIds = (events: SessionEvent[]) => events.map((event, i) => ({ ...event, id: `${MAIN_APP}:launch-1:${i + 1}:0` as EventId, seq: i + 1 }));
  // A turn mid-tool, as a supervisor's kill -9 leaves it: started, a Bash call with no result, no end.
  const midTurn = () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'git log --oneline' });
    return liveIds(b.events);
  };
  const divider = () => useTranscriptStore.getState().rows(APP).find((row): row is Extract<Row, { kind: 'divider' }> => row.kind === 'divider')!;
  const exitRows = () => useTranscriptStore.getState().rows(APP).filter((row) => row.kind === 'error' && row.scope === 'exit');
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function hydrated(events: SessionEvent[]) {
    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, APP);
    const attached = useTranscriptStore.getState().attach(source.key!, source);
    fake.calls[0].answer({ ok: true, value: { events, lastSeq: events.length, complete: true } } as never);
    await attached;
    return { fake, source };
  }
  const table = (fake: ReturnType<typeof fakeClient>, ids: AppSessionId[]) => {
    const call = fake.calls.find((candidate) => candidate.name === 'engine.sessions' && !candidate.answered)!;
    call.answered = true;
    call.answer({ ok: true, value: ids.map((appSessionId) => ({ appSessionId })) } as never);
  };

  it('a successor that does not list the session closes its running turn as stopped, with one crash exit row', async () => {
    const { fake, source } = await hydrated(midTurn());
    expect(divider().state).toBe('working');
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events', 'engine.sessions']);
    table(fake, [at('other' as AppSessionId)]);
    await flush();
    expect(divider().state).toBe('stopped');
    expect(useTranscriptStore.getState().entries[APP].working).toBe(false);
    expect(exitRows()).toMatchObject([{ severity: 'error', text: 'Session process exited (crash)' }]);
    // a later departure finds nothing running: no second read, no second row
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    await flush();
    expect(fake.calls.filter((call) => call.name === 'engine.sessions')).toHaveLength(1);
    expect(exitRows()).toHaveLength(1);
    useTranscriptStore.getState().detach(source.key!);
  });

  it('a host that still lists the session (a same-pid reconnect) speaks for it: the turn keeps working', async () => {
    const { fake, source } = await hydrated(midTurn());
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    table(fake, [APP]);
    await flush();
    expect(divider().state).toBe('working');
    expect(exitRows()).toEqual([]);
    useTranscriptStore.getState().detach(source.key!);
  });

  it('a session whose process already exited, or that the stream never showed running, is not asked about', async () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Done.');
    b.end(['u1']);
    b.emit('process.exited', { code: 0, signal: null, reason: 'stop', lostAttentionCount: 0, budget: null });
    const { fake, source } = await hydrated(liveIds(b.events));
    fake.emit('engine.hostState', { state: 'crashed' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    await flush();
    expect(fake.calls.map((call) => call.name)).toEqual(['session.events']);
    useTranscriptStore.getState().detach(source.key!);

    const disk = midTurn().map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null })); // read from disk: not ours to run
    const second = await hydrated(disk);
    second.fake.emit('engine.hostState', { state: 'restarting' } as never);
    second.fake.emit('engine.hostState', { state: 'ready' } as never);
    await flush();
    expect(second.fake.calls.map((call) => call.name)).toEqual(['session.events']);
    useTranscriptStore.getState().detach(second.source.key!);
  });

  // P5 O16 M3c: a successor of a host that kept its sessions under session hosts adopts them, and its ready comes before
  // its start's adoptions end; a session it has not adopted yet is not listed, so it is asked again once main's status
  // says the adoptions ended
  const holderStatus = (adopting: boolean) => ({ state: 'ready', supervisor: { pid: 5151, holder: { hosts: 1, adopted: adopting ? 0 : 1, failed: 0, gate: null, handover: 'none', adopting } } });

  it('a successor still adopting is asked again once its adoptions end: a session it adopted keeps working', async () => {
    const { fake, source } = await hydrated(midTurn());
    fake.host.status = holderStatus(true);
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    table(fake, []); // not adopted yet
    await flush();
    expect(divider().state, 'nothing told while it adopts').toBe('working');
    expect(fake.calls.filter((call) => call.name === 'engine.sessions')).toHaveLength(1);
    fake.emit('host.status', holderStatus(false) as never);
    await flush();
    table(fake, [APP]);
    await flush();
    expect(divider().state).toBe('working');
    expect(exitRows()).toEqual([]);
    useTranscriptStore.getState().detach(source.key!);
  });

  it('a session the successor did not adopt is closed once its adoptions end, with one crash exit row', async () => {
    const { fake, source } = await hydrated(midTurn());
    fake.host.status = { state: 'ready', supervisor: null }; // its first status not heard yet: unknown, so waited for
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    table(fake, []);
    await flush();
    fake.emit('host.status', holderStatus(true) as never);
    await flush();
    expect(divider().state).toBe('working');
    fake.emit('host.status', holderStatus(false) as never);
    await flush();
    table(fake, []); // the adoption failed
    await flush();
    expect(divider().state).toBe('stopped');
    expect(exitRows()).toMatchObject([{ severity: 'error', text: 'Session process exited (crash)' }]);
    useTranscriptStore.getState().detach(source.key!);
  });

  it('a departure heard while the successor adopts says nothing; the next ready asks again', async () => {
    const { fake, source } = await hydrated(midTurn());
    fake.host.status = holderStatus(true);
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    table(fake, []);
    await flush();
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('host.status', { state: 'restarting', supervisor: null } as never);
    await flush();
    expect(divider().state, 'the stale read tells nothing').toBe('working');
    expect(fake.calls.filter((call) => call.name === 'engine.sessions')).toHaveLength(1);
    useTranscriptStore.getState().detach(source.key!);
  });

  // P5 O16 M3c fix wave 1: the adoption wait's `host.status` listener ends with the subscription
  it('a detach while the successor adopts removes the wait’s listener and tells nothing', async () => {
    const { fake, source } = await hydrated(midTurn());
    fake.host.status = holderStatus(true);
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    table(fake, []);
    await flush();
    expect(fake.listeners.get('host.status')?.size ?? 0, 'the wait listens').toBeGreaterThan(0);
    useTranscriptStore.getState().detach(source.key!);
    expect(fake.listeners.get('host.status')?.size ?? 0, 'gone with the subscription').toBe(0);
    fake.emit('host.status', holderStatus(false) as never);
    await flush();
    expect(fake.calls.filter((call) => call.name === 'engine.sessions')).toHaveLength(1);
  });

  // P5 O16 M3c fix wave 2 (the re-review's item 7): a detach during the table's read installs no wait after the cleanup
  it('a detach while the table is read creates no wait once it answers: no listener, no host.status asked', async () => {
    const { fake, source } = await hydrated(midTurn());
    fake.host.status = holderStatus(true);
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    await flush();
    expect(fake.calls.filter((call) => call.name === 'engine.sessions'), 'the table is being read').toHaveLength(1);
    useTranscriptStore.getState().detach(source.key!);
    let listened = 0;
    const listen = fake.client.on;
    fake.client.on = ((name: EventName, listener: never) => ((listened += name === 'host.status' ? 1 : 0), listen(name, listener))) as MawsBridge['on'];
    table(fake, []); // it answers after the cleanup, empty
    await flush();
    expect(listened, 'no wait listens').toBe(0);
    expect(fake.host.asked, 'nothing asked').toBe(0);
  });

  it('a host without session hosts is read once, as before', async () => {
    const { fake, source } = await hydrated(midTurn());
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    table(fake, []);
    await flush();
    expect(divider().state).toBe('stopped');
    expect(fake.calls.filter((call) => call.name === 'engine.sessions')).toHaveLength(1);
    useTranscriptStore.getState().detach(source.key!);
  });

  // The branch review: `engine.hostState` crosses machine links. Another machine's host leaving says nothing about this
  // session's process, and a session on another machine reads that machine's table.
  it('hears only its own machine’s engine host, and reads its own machine’s table', async () => {
    const { fake, source } = await hydrated(midTurn());
    fake.emit('engine.hostState', { state: 'restarting' } as never, OTHER_MACHINE);
    fake.emit('engine.hostState', { state: 'ready' } as never, OTHER_MACHINE);
    await flush();
    expect(fake.calls.map((call) => call.name), 'B’s host says nothing of a session on this machine').toEqual(['session.events']);
    expect(divider().state).toBe('working');
    useTranscriptStore.getState().detach(source.key!);

    const onB = addressOf(OTHER_MACHINE, 'app-b' as AppSessionId);
    const other = fakeClient();
    const bSource = ipcSourceOver(other.client, onB);
    const attached = useTranscriptStore.getState().attach(bSource.key!, bSource);
    const events = midTurn().map((event) => ({ ...event, id: (event.id as string).replace(MAIN_APP, 'app-b') as EventId }));
    other.calls[0].answer({ ok: true, value: { events, lastSeq: events.length, complete: true } } as never);
    await attached;
    other.emit('engine.hostState', { state: 'restarting' } as never, TEST_MACHINE);
    other.emit('engine.hostState', { state: 'ready' } as never, TEST_MACHINE);
    expect(other.calls.map((call) => call.name), 'this machine’s host says nothing of B’s session').toEqual(['session.events']);
    other.emit('engine.hostState', { state: 'restarting' } as never, OTHER_MACHINE);
    other.emit('engine.hostState', { state: 'ready' } as never, OTHER_MACHINE);
    expect(other.calls.filter((call) => call.name === 'engine.sessions').map((call) => call.machine), 'B’s table, read on B').toEqual([OTHER_MACHINE]);
    useTranscriptStore.getState().detach(bSource.key!);
  });

  // O16 panel 1 (sweep#4): another machine's successor also comes ready before its start's adoptions end. Its status is
  // not main's to tell (host.status is this machine's), so that machine's engine host is asked for its supervisor status
  // until its adoptions end, and the table read again: no crash row for a session it adopts.
  describe('on another machine', () => {
    const onB = addressOf(OTHER_MACHINE, 'app-b' as AppSessionId);
    const rowsB = () => useTranscriptStore.getState().rows(onB);
    const dividerB = () => rowsB().find((row): row is Extract<Row, { kind: 'divider' }> => row.kind === 'divider')!;
    const exitRowsB = () => rowsB().filter((row) => row.kind === 'error' && row.scope === 'exit');
    const unanswered = (fake: ReturnType<typeof fakeClient>, name: string) => fake.calls.filter((call) => call.name === name && !call.answered);
    const answer = (fake: ReturnType<typeof fakeClient>, name: string, value: unknown) => {
      const call = unanswered(fake, name)[0]!;
      call.answered = true;
      call.answer({ ok: true, value } as never);
      return call;
    };
    const supervisor = (adopting: boolean) => ({ pid: 6262, holder: { hosts: 1, adopted: adopting ? 0 : 1, failed: 0, gate: null, handover: 'none', adopting } });
    const poll = () => new Promise((resolve) => setTimeout(resolve, REMOTE_ADOPTIONS_POLL_MS + 50));

    async function remote() {
      const fake = fakeClient();
      const source = ipcSourceOver(fake.client, onB);
      const attached = useTranscriptStore.getState().attach(source.key!, source);
      const events = midTurn().map((event) => ({ ...event, id: (event.id as string).replace(MAIN_APP, 'app-b') as EventId }));
      fake.calls[0].answer({ ok: true, value: { events, lastSeq: events.length, complete: true } } as never);
      await attached;
      fake.emit('engine.hostState', { state: 'restarting' } as never, OTHER_MACHINE);
      fake.emit('engine.hostState', { state: 'ready' } as never, OTHER_MACHINE);
      answer(fake, 'engine.sessions', []); // not adopted yet
      await flush();
      return { fake, source };
    }

    it('a successor still adopting is asked on its machine until its adoptions end: a session it adopted keeps working', async () => {
      const { fake, source } = await remote();
      expect(answer(fake, 'host.supervisorStatus', supervisor(true)).machine, 'B’s engine host, asked on B').toEqual(OTHER_MACHINE);
      await flush();
      expect(dividerB().state, 'nothing told while it adopts').toBe('working');
      await poll();
      answer(fake, 'host.supervisorStatus', supervisor(false));
      await flush();
      expect(answer(fake, 'engine.sessions', [{ appSessionId: onB }]).machine).toEqual(OTHER_MACHINE);
      await flush();
      expect(dividerB().state).toBe('working');
      expect(exitRowsB()).toEqual([]);
      useTranscriptStore.getState().detach(source.key!);
    });

    it('a session it did not adopt is closed once its adoptions end; a host without session hosts is read once, as before', async () => {
      const { fake, source } = await remote();
      answer(fake, 'host.supervisorStatus', supervisor(false));
      await flush();
      answer(fake, 'engine.sessions', []); // the adoption failed
      await flush();
      expect(dividerB().state).toBe('stopped');
      expect(exitRowsB()).toHaveLength(1);
      useTranscriptStore.getState().detach(source.key!);

      const second = await remote();
      answer(second.fake, 'host.supervisorStatus', { pid: 6263 }); // a build before the holder: no session hosts
      await flush();
      expect(unanswered(second.fake, 'engine.sessions')).toEqual([]);
      expect(dividerB().state).toBe('stopped');
      useTranscriptStore.getState().detach(second.source.key!);
    });

    it('a departure heard on its machine while the successor adopts ends the wait and tells nothing', async () => {
      const { fake, source } = await remote();
      answer(fake, 'host.supervisorStatus', supervisor(true));
      await flush(); // its next ask waits
      fake.emit('engine.hostState', { state: 'restarting' } as never, OTHER_MACHINE);
      await poll();
      expect(unanswered(fake, 'host.supervisorStatus'), 'no further ask').toEqual([]);
      expect(dividerB().state).toBe('working');
      useTranscriptStore.getState().detach(source.key!);
    });
  });

  it('a table read asked before a later departure says nothing; the next ready asks again', async () => {
    const { fake, source } = await hydrated(midTurn());
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    fake.emit('engine.hostState', { state: 'ready' } as never);
    fake.emit('engine.hostState', { state: 'restarting' } as never);
    table(fake, []); // stale: the host left again meanwhile
    await flush();
    expect(divider().state).toBe('working');
    fake.emit('engine.hostState', { state: 'ready' } as never);
    table(fake, []);
    await flush();
    expect(divider().state).toBe('stopped');
    useTranscriptStore.getState().detach(source.key!);
  });
});

// The UX wave, U9 (O-11b; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, M3): a first read of a session on
// this Mac that failed because its engine host was away (`host_unavailable`) is made again at the host's next ready, once
// per ready, the key hydrating meanwhile (the pane's "Loading…"); a ready newer than the read's start that is already in
// the hosts store when the failure is processed is that ready, consumed at once. With no ready in 15 s, or a second
// failure, the key fails ("Couldn’t load this conversation"), and a later ready still loads it.
describe('a first read the engine host’s absence failed (O-11b)', () => {
  const ROW = { events: [], lastSeq: 0, complete: true };
  const host = (state: 'ready' | 'crashed' | 'restarting', revision: number) => act(() => useHosts.setState({ hosts: { engine: { state, pid: state === 'ready' ? 7 : null, restarts: 0, revision }, pty: null } }));
  const away = { ok: false, error: { code: 'host_unavailable', message: 'engine-host exited before answering session.events' } } as const;
  const reads = (fake: ReturnType<typeof fakeClient>) => fake.calls.filter((call) => call.name === 'session.events');
  const phase = (key: AppSessionId = APP) => useTranscriptStore.getState().entries[key]?.phase;
  const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
  const attached = (key: AppSessionId = APP) => {
    const fake = fakeClient();
    void useTranscriptStore.getState().attach(key, ipcSourceOver(fake.client, key));
    return fake;
  };
  afterEach(() => {
    useHosts.setState({ hosts: { engine: null, pty: null } });
    vi.useRealTimers();
  });

  it('is read again at the host’s next ready, once, the key hydrating meanwhile', async () => {
    vi.useFakeTimers();
    host('ready', 3);
    const fake = attached();
    reads(fake)[0]!.answer(away as never);
    await settle();
    expect(phase(), 'no failure while the host may come back').toBe('hydrating');
    host('restarting', 4);
    await settle();
    expect(reads(fake)).toHaveLength(1);
    host('ready', 5);
    await settle();
    expect(reads(fake), 'one read at the ready').toHaveLength(2);
    reads(fake)[1]!.answer({ ok: true, value: ROW } as never);
    await settle();
    expect(phase()).toBe('live');
    host('ready', 7);
    await settle();
    expect(reads(fake), 'nothing more once whole').toHaveLength(2);
  });

  it('takes a ready that overtook the failure, newer than the read’s start, at once', async () => {
    vi.useFakeTimers();
    host('ready', 3);
    const fake = attached();
    host('crashed', 4);
    host('ready', 6); // the successor is ready before the failure is processed
    reads(fake)[0]!.answer(away as never);
    await settle();
    expect(reads(fake), 'read again at once, waiting for no other restart').toHaveLength(2);
    reads(fake)[1]!.answer({ ok: true, value: ROW } as never);
    await settle();
    expect(phase()).toBe('live');
  });

  it('fails the key when no ready comes within 15 s, and a later ready still loads it', async () => {
    vi.useFakeTimers();
    host('crashed', 4);
    const fake = attached();
    reads(fake)[0]!.answer(away as never);
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(HOST_RETURN_WAIT_MS - 1));
    expect(phase()).toBe('hydrating');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(useTranscriptStore.getState().entries[APP]).toMatchObject({ phase: 'failed', error: 'engine-host exited before answering session.events' });
    host('ready', 5);
    await settle();
    expect(reads(fake), 'the host’s return reads it again').toHaveLength(2);
    expect(phase()).toBe('hydrating');
    reads(fake)[1]!.answer({ ok: true, value: ROW } as never);
    await settle();
    expect(phase()).toBe('live');
  });

  it('fails the key at a second failure, and reads it once per later ready, never on its own', async () => {
    vi.useFakeTimers();
    host('ready', 3);
    const fake = attached();
    reads(fake)[0]!.answer(away as never);
    host('ready', 5);
    await settle();
    reads(fake)[1]!.answer(away as never);
    await settle();
    expect(phase()).toBe('failed');
    await act(() => vi.advanceTimersByTimeAsync(10 * HOST_RETURN_WAIT_MS));
    expect(reads(fake), 'no retry on a timer').toHaveLength(2);
    host('ready', 7);
    await settle();
    expect(reads(fake)).toHaveLength(3);
  });

  it('takes a ready that overtook the retry’s own failure at once, and only once', async () => {
    vi.useFakeTimers();
    host('ready', 3);
    const fake = attached();
    reads(fake)[0]!.answer(away as never);
    host('ready', 5);
    await settle();
    expect(reads(fake), 'read 2 at ready 5').toHaveLength(2);
    host('crashed', 6);
    host('ready', 7); // the next host is ready while read 2 is out
    reads(fake)[1]!.answer(away as never);
    await settle();
    expect(reads(fake), 'read 3 at ready 7, with no ready 9').toHaveLength(3);
    reads(fake)[2]!.answer(away as never);
    await act(() => vi.advanceTimersByTimeAsync(HOST_RETURN_WAIT_MS));
    expect(phase()).toBe('failed');
    expect(reads(fake), 'ready 7 is not used twice').toHaveLength(3);
    host('ready', 9);
    await settle();
    expect(reads(fake)).toHaveLength(4);
  });

  it('fails at once for any other failure, and for a session on another machine (its link’s return heals it)', async () => {
    vi.useFakeTimers();
    host('ready', 3);
    const local = attached();
    reads(local)[0]!.answer({ ok: false, error: { code: 'internal', message: 'session.events: the journal could not be read' } } as never);
    await settle();
    expect(phase()).toBe('failed');
    const REMOTE = addressOf(OTHER_MACHINE, 'app-o' as AppSessionId);
    const remote = attached(REMOTE);
    reads(remote)[0]!.answer({ ok: false, error: { code: 'host_unavailable', message: 'Studio is offline' } } as never);
    await settle();
    expect(phase(REMOTE)).toBe('failed');
    host('ready', 5);
    await settle();
    expect(reads(local), 'no ready retries a failure the host did not cause').toHaveLength(1);
    expect(reads(remote)).toHaveLength(1);
  });

  it('stops waiting when the pane lets the key go', async () => {
    vi.useFakeTimers();
    host('crashed', 4);
    const fake = attached();
    reads(fake)[0]!.answer(away as never);
    await settle();
    act(() => useTranscriptStore.getState().detach(APP));
    host('ready', 5);
    await settle();
    expect(reads(fake)).toHaveLength(1);
  });
});
