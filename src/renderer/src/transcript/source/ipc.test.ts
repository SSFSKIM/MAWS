// The IPC adapters (C6 M5) against a fake X2 client: `ipcSource` under the store's hydration protocol (live batches
// from `session.eventBatch`, the snapshot from `session.events`, or `fs.agentEvents` for a child), the default
// `loadSpill` over `fs.readSpill`, and the receipt's rewind interface over `session.rewindFiles`.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, EventId, ParentToolUseId } from '@shared/graph/ids';
import type { CommandName, CommandResult, EventName, EventPayload, MawsBridge } from '@shared/ipc/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { useTranscriptStore } from '../../stores/transcript';
import { rowsOf } from '../model/derive';
import { turnId } from '../model/keys';
import { applyEvents, createState } from '../model/reduce';
import { builder, uuid } from '../model/test-events';
import { ipcLoadSpillOver, ipcRewindOver, ipcSourceOver } from './ipc';

const APP = 'app-1' as AppSessionId;
const AGENT = 'agent-7' as AgentId;

// A fake X2 client: every invoke waits for the test to answer it; events are pushed by name.
function fakeClient() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const calls: { name: string; input: unknown; answer: (result: CommandResult<CommandName>) => void }[] = [];
  const client: MawsBridge = {
    invoke: ((name: CommandName, input: unknown) => new Promise((resolve) => calls.push({ name, input, answer: resolve as never }))) as MawsBridge['invoke'],
    on: ((name: EventName, listener: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    }) as MawsBridge['on'],
  };
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => {
    for (const listener of listeners.get(name) ?? []) listener(payload);
  };
  return { client, calls, emit, listeners };
}

const batch = (events: SessionEvent[], appSessionId = APP) => ({ appSessionId, events });

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

  it('keeps a followed child’s own events out of the parent; the child’s parent-side traffic still reaches it', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Agent', { description: 'Look around', prompt: 'look' });
    b.end(['u1']);
    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, APP);
    const received: EventId[][] = [];
    source.subscribe((events) => received.push(events.map((event) => event.id)));
    const own = { ...b.events[0], id: 'own' as EventId, agentId: AGENT }; // the child's slice: top-level in its own transcript
    const traffic = { ...b.events[0], id: 'traffic' as EventId, agentId: AGENT, parentToolUseId: 't1' as ParentToolUseId };
    fake.emit('session.eventBatch', batch([b.events[0], own, traffic]));
    fake.emit('session.eventBatch', batch([own]));
    expect(received).toEqual([[b.events[0].id, 'traffic']]);
  });

  it('a child source keys `appSessionId:agentId`, snapshots from fs.agentEvents and follows only that agent', async () => {
    const b = builder();
    b.text('c1', 0, 'Child answer');
    const child = b.events.map((event) => ({ ...event, agentId: AGENT }));
    const fake = fakeClient();
    const source = ipcSourceOver(fake.client, APP, AGENT);
    expect(source.key).toBe(`${APP}:${AGENT}`);
    expect(source.agentId).toBe(AGENT);
    const received: SessionEvent[][] = [];
    source.subscribe((events) => received.push(events));
    const snapshot = source.snapshot();
    expect(fake.calls.map((call) => [call.name, call.input])).toEqual([['fs.agentEvents', { appSessionId: APP, agentId: AGENT }]]);
    fake.calls[0].answer({ ok: true, value: { events: child, complete: true } });
    await expect(snapshot).resolves.toEqual(child);
    fake.emit('session.eventBatch', batch([...child, { ...child[0], id: 'parent' as EventId, agentId: null }, { ...child[0], id: 'other' as EventId, agentId: 'agent-8' as AgentId }]));
    expect(received).toEqual([child]);
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

describe('default loadSpill', () => {
  it('reads the spill through fs.readSpill, up to the 2 MB head, and rejects with the X2 error', async () => {
    const fake = fakeClient();
    const load = ipcLoadSpillOver(fake.client);
    const spill = { path: '/cfg/projects/p/s/tool-results/toolu_1.txt', bytes: 188_416, state: 'not_loaded' as const, content: null };
    const loaded = load(spill);
    expect(fake.calls.map((call) => [call.name, call.input])).toEqual([['fs.readSpill', { path: spill.path, length: 2 * 1024 * 1024 }]]);
    fake.calls[0].answer({ ok: true, value: { content: 'full', bytes: 188_416, offset: 0, truncated: false } });
    await expect(loaded).resolves.toBe('full');
    const refused = load(spill);
    fake.calls[1].answer({ ok: false, error: { code: 'internal', message: 'path outside the engine store' } });
    await expect(refused).rejects.toThrow('path outside the engine store');
  });
});

describe('rewind adapter', () => {
  const OUTCOME = { ok: true, enabled: true, message: null, filesChanged: 2, insertions: 3, deletions: 1, skippedLinks: 0 };

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
