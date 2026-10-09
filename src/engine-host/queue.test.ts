import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, EventId, MessageUuid, SessionId } from '@shared/graph/ids';
import type { QueueEntry, QueueState } from '@shared/engine/session-state-store';
import type { UserInputFrame } from '@shared/wire/frames';
import { MessageQueue } from './queue';
import { MemorySessionStateStore } from './store/memory-session-state-store';
import { SessionEventSchema } from '@shared/graph/events'; // P2-C
import { Normalizer } from './normalizer'; // P2-C

const ID = 'app-q' as AppSessionId;
type TurnEnded = Extract<SessionEvent, { kind: 'turn.ended' }>;
type Lifecycle = Extract<SessionEvent, { kind: 'command.lifecycle' }>;

const base = { id: 'e' as EventId, sessionId: 's' as SessionId, at: '2026-09-28T10:00:00.000Z', seq: 1, agentId: null, parentToolUseId: null };
const turnEnded = (over: Partial<TurnEnded> = {}): TurnEnded => ({
  ...base, kind: 'turn.ended', result: 'success', isError: false, terminalReason: 'completed', resultText: 'OK', durationMs: 1, numTurns: 1, costUsd: 0,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null }, permissionDenials: [], errors: [],
  userMessageUuids: [], origin: 'human', resultIndex: null, isEchoReceipt: false, ...over,
});
const lifecycle = (commandUuid: MessageUuid | null, state: Lifecycle['state'] = 'queued'): Lifecycle => ({ ...base, kind: 'command.lifecycle', commandUuid: commandUuid!, state });
const flush = () => new Promise((r) => setImmediate(r));

// A queue over fake session deps: `writes` are the user frames that reached the pipe, `rows` the meta rows journaled,
// `turn` stands in for the normaliser's open turn (a write opens one, as the out row does). `onWrite` runs when a frame
// reached the pipe, before the write resolves (where the real writer's settle drains the inbound frames it held);
// `cancelAnswer`, when set, is what the engine's answer to a cancel waits on.
async function harness(opts: { store?: MemorySessionStateStore; failWrite?: (frame: UserInputFrame) => boolean; holdWrites?: boolean; recovered?: boolean; holdAllDeadlineMs?: number } = {}) {
  const store = opts.store ?? new MemorySessionStateStore();
  const writes: UserInputFrame[] = [];
  const rows: Record<string, unknown>[] = [];
  const changes: QueueState[] = [];
  const held: (() => void)[] = [];
  const cancels: MessageUuid[] = [];
  const prefaces: (Record<string, unknown>[] | undefined)[] = []; // E1: each write's preface rows, as the writer was handed them
  const timeline: ({ row: Record<string, unknown> } | { change: QueueState })[] = []; // P2-C: rows and published changes, in the order they happened
  const h = { turn: false, ready: true, cancelled: true, store, writes, rows, changes, held, cancels, prefaces, timeline, storeAtWrite: [] as QueueState[], onWrite: null as ((frame: UserInputFrame) => void) | null, cancelAnswer: null as Promise<void> | null, cancelFor: null as ((uuid: MessageUuid) => boolean | Promise<boolean>) | null };
  const queue = new MessageQueue({
    appSessionId: ID,
    store,
    write: async (frame, writeOpts) => {
      prefaces.push(writeOpts?.preface);
      h.storeAtWrite.push(await store.loadQueue(ID)); // what a crash at this instant would leave behind
      if (opts.holdWrites) await new Promise<void>((r) => held.push(r));
      if (opts.failWrite?.(frame)) throw new Error('EPIPE');
      writes.push(frame);
      if (frame.shouldQuery !== false) h.turn = true;
      h.onWrite?.(frame);
    },
    meta: (frame) => {
      rows.push(frame);
      timeline.push({ row: frame }); // P2-C
    },
    turnOpen: () => h.turn,
    canWrite: () => h.ready,
    cancel: async (uuid) => {
      cancels.push(uuid); // W1: `cancel_async_message`
      await h.cancelAnswer;
      return h.cancelFor ? h.cancelFor(uuid) : h.cancelled;
    },
    onChange: (q) => {
      changes.push(q);
      timeline.push({ change: q }); // P2-C
    },
    log: () => {},
    holdAllDeadlineMs: opts.holdAllDeadlineMs,
  });
  if (opts.recovered !== false) await queue.recover(); // what the session does before `ready`
  return { ...h, h, queue };
}

const notices = (rows: Record<string, unknown>[]) => rows.filter((r) => r.event === 'notice').map((r) => r.key);
// The queue's rows from before P2-C (releases, holds, pauses, resumes); P2-C's prompt record is read through `transitions`.
const PRE_P2C_ROWS: ReadonlySet<unknown> = new Set(['release', 'hold', 'pause', 'resume']);
const queueRows = (rows: Record<string, unknown>[]) => rows.filter((r) => r.event === 'queue' && PRE_P2C_ROWS.has(r.action)).map((r) => `${String(r.action)}:${String(r.trigger ?? r.reason)}`);

afterEach(() => {
  vi.useRealTimers();
});

describe('queue release never follows an engine-initiated turn', () => {
  it('a send while a turn is open is queued and persisted; the human turn\'s end releases it as a plain human frame', async () => {
    const t = await harness();
    t.h.turn = true;
    const { entry, disposition } = await t.queue.send('second');
    expect(disposition).toBe('queued');
    expect(entry).toMatchObject({ state: 'queued', messageUuid: null, uncertain: false, content: 'second', appSessionId: ID });
    expect((await t.store.loadQueue(ID)).entries).toEqual([entry]);
    expect(t.writes).toEqual([]);

    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ origin: 'human' }));
    expect(t.writes).toHaveLength(1);
    const frame = t.writes[0]!;
    expect(frame).toEqual({ type: 'user', uuid: frame.uuid, message: { role: 'user', content: 'second' }, parent_tool_use_id: null, origin: { kind: 'human' } });
    expect(frame).not.toHaveProperty('priority');
    expect(t.queue.state.entries).toMatchObject([{ state: 'submitting', messageUuid: frame.uuid }]);
    expect(queueRows(t.rows)).toEqual(['release:turn_ended']);
  });

  it('two sends in the same tick at an idle session serialise: sent then queued, one frame, the first persisted as submitting before the write', async () => {
    const t = await harness();
    const [first, second] = await Promise.all([t.queue.send('one'), t.queue.send('two')]);
    expect([first.disposition, second.disposition]).toEqual(['sent', 'queued']);
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0]!.message.content).toBe('one');
    expect(t.storeAtWrite[0]!.entries[0]).toMatchObject({ queueId: first.entry.queueId, state: 'submitting', messageUuid: t.writes[0]!.uuid });
    expect(first.entry.messageUuid).toBe(t.writes[0]!.uuid);
    expect(second.entry).toMatchObject({ state: 'queued', messageUuid: null });
  });

  it('the engine\'s command_lifecycle releases the submission; the turn.ended naming it removes it and releases the next', async () => {
    const t = await harness();
    const { entry } = await t.queue.send('one');
    await t.queue.send('two');
    const uuid = entry.messageUuid!;
    t.queue.onLifecycle(lifecycle(uuid, 'queued'));
    expect(t.queue.state.entries.map((e) => e.state)).toEqual(['released', 'queued']);
    expect(t.queue.busy).toBe(true);
    await flush();
    expect((await t.store.loadQueue(ID)).entries[0]!.state).toBe('released');

    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ userMessageUuids: [uuid] }));
    expect(t.writes.map((w) => w.message.content)).toEqual(['one', 'two']);
    expect(t.queue.state.entries).toMatchObject([{ content: 'two', state: 'submitting' }]);
  });

  it('a submission the engine cancels, discards or refuses before it started is retired at that lifecycle with its own notice, and the next queued message is released (whole-branch review; pass1/queue-and-interrupt seq 191)', async () => {
    for (const state of ['cancelled', 'discarded'] as const) {
      const t = await harness();
      const { entry } = await t.queue.send('one');
      await t.queue.send('two');
      t.queue.onLifecycle(lifecycle(entry.messageUuid!, 'queued'));
      t.queue.onLifecycle(lifecycle(entry.messageUuid!, state));
      t.h.turn = false; // the normaliser stopped waiting on the dropped prompt: no turn is open
      await flush();
      await flush();
      expect(t.queue.state.entries).toMatchObject([{ content: 'two', state: 'submitting' }]);
      expect(notices(t.rows)).toEqual([`queue:dropped:${entry.queueId}`]);
      expect(t.rows.find((r) => r.event === 'notice')!.text).toContain(`The engine ${state} a message before starting it`);
      expect((await t.store.loadQueue(ID)).entries.map((e) => [e.content, e.state])).toEqual([['two', 'submitting']]);
      expect(t.writes.map((w) => w.message.content)).toEqual(['one', 'two']); // the dropped one is not re-sent; the next goes
      expect(queueRows(t.rows)).toEqual(['release:send', 'release:dropped']);
    }
    // a refused drop retires the entry the same way but pauses the queue and releases nothing (coordinator ruling)
    const refused = await harness();
    const { entry: refusedEntry } = await refused.queue.send('one');
    await refused.queue.send('two');
    refused.queue.onLifecycle(lifecycle(refusedEntry.messageUuid!, 'queued'));
    refused.queue.onLifecycle(lifecycle(refusedEntry.messageUuid!, 'refused'));
    refused.h.turn = false;
    await flush();
    await flush();
    expect(refused.queue.state).toMatchObject({ paused: true, entries: [{ content: 'two', state: 'queued' }] });
    expect(notices(refused.rows)).toEqual([`queue:dropped:${refusedEntry.queueId}`]);
    expect(queueRows(refused.rows)).toEqual(['release:send', 'pause:refused']);
    expect(refused.writes.map((w) => w.message.content)).toEqual(['one']);
    expect(await refused.store.loadQueue(ID)).toMatchObject({ paused: true, entries: [{ content: 'two', state: 'queued' }] });
    await refused.queue.setPaused(false); // resume is one click
    expect(refused.writes.map((w) => w.message.content)).toEqual(['one', 'two']);
    expect(refused.rows.find((r) => r.event === 'notice')!.text).toContain('The queue is paused; resume it to send the next message.');
    // with nothing waiting, a refused drop does not pause: a paused empty queue would silently hold the next send
    const alone = await harness();
    const { entry: only } = await alone.queue.send('one');
    alone.queue.onLifecycle(lifecycle(only.messageUuid!, 'refused'));
    alone.h.turn = false;
    await flush();
    expect(alone.queue.state).toEqual({ entries: [], paused: false, pauseReason: null }); // C7: pauseReason
    expect(queueRows(alone.rows)).toEqual(['release:send']);
    expect(alone.rows.find((r) => r.event === 'notice')!.text).not.toContain('paused');
    // a paused queue (an interrupt pauses before it cancels) releases nothing at the drop
    const paused = await harness();
    const { entry: sent } = await paused.queue.send('one');
    await paused.queue.send('two');
    await paused.queue.pause('interrupt');
    paused.queue.onLifecycle(lifecycle(sent.messageUuid!, 'cancelled'));
    paused.h.turn = false;
    await flush();
    await flush();
    expect(paused.queue.state.entries).toMatchObject([{ content: 'two', state: 'queued' }]);
    expect(paused.writes.map((w) => w.message.content)).toEqual(['one']);
    // a drop while another turn is open releases nothing into it; that turn's end does
    const open = await harness();
    const { entry: dropped } = await open.queue.send('one');
    await open.queue.send('two');
    open.queue.onLifecycle(lifecycle(dropped.messageUuid!, 'cancelled'));
    await flush();
    await flush();
    expect(open.writes.map((w) => w.message.content)).toEqual(['one']);
    // dropped at its first lifecycle, still submitting: the same
    const first = await harness();
    const { entry } = await first.queue.send('one');
    first.queue.onLifecycle(lifecycle(entry.messageUuid!, 'cancelled'));
    first.h.turn = false;
    await flush();
    expect(first.queue.state.entries).toEqual([]);
    expect((await first.queue.send('again')).disposition).toBe('sent');
  });

  it('a cancelled lifecycle after the submission started retires nothing: its turn.ended does', async () => {
    const t = await harness();
    const { entry } = await t.queue.send('one');
    t.queue.onLifecycle(lifecycle(entry.messageUuid!, 'queued'));
    t.queue.onLifecycle(lifecycle(entry.messageUuid!, 'started'));
    t.queue.onLifecycle(lifecycle(entry.messageUuid!, 'cancelled'));
    await flush();
    expect(t.queue.state.entries).toMatchObject([{ state: 'released' }]);
    expect(notices(t.rows)).toEqual([]);
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ userMessageUuids: [entry.messageUuid!], terminalReason: 'aborted_streaming' }));
    expect(t.queue.state.entries).toEqual([]);
  });

  it('a result naming a submission the engine never acknowledged still retires it', async () => {
    const t = await harness();
    const { entry } = await t.queue.send('one');
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ userMessageUuids: [entry.messageUuid!] }));
    expect(t.queue.state.entries).toEqual([]);
    expect(t.queue.busy).toBe(false);
  });

  it('nothing is released into a running turn: an engine turn ending while another is open, an echo receipt and a child lane release nothing', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('waiting');
    await t.queue.onTurnEnded(turnEnded({ origin: 'task-notification', userMessageUuids: [] })); // another turn is still open
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ origin: 'human', isEchoReceipt: true, numTurns: 0, terminalReason: null }));
    await t.queue.onTurnEnded(turnEnded({ origin: 'human', parentToolUseId: 'toolu_x' as TurnEnded['parentToolUseId'] }));
    expect(t.writes).toEqual([]);
    expect(t.queue.state).toMatchObject({ paused: false, entries: [{ state: 'queued' }] });
    expect(t.rows).toEqual([]);
  });

  it('an engine turn that leaves the session idle releases the head exactly as a human turn does (concern 1, as ruled)', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('typed during the engine turn');
    await t.queue.send('and another');
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ origin: 'task-notification' }));
    expect(t.writes.map((w) => w.message.content)).toEqual(['typed during the engine turn']);
    expect(t.writes[0]).not.toHaveProperty('priority');
    expect(queueRows(t.rows)).toEqual(['release:turn_ended']);
    expect(t.queue.state.paused).toBe(false);
    expect(notices(t.rows)).toEqual([]);
  });

  it('after an engine turn a head that cannot go pauses the queue (engine_turn) with an info notice naming it: not ready, or the write failed', async () => {
    const notReady = await harness();
    notReady.h.turn = true;
    const { entry: head } = await notReady.queue.send('held');
    notReady.h.turn = false;
    notReady.h.ready = false;
    await notReady.queue.onTurnEnded(turnEnded({ origin: 'task-notification' }));
    expect(notReady.writes).toEqual([]);
    expect(notReady.queue.state).toMatchObject({ paused: true, entries: [{ state: 'queued' }] });
    expect(queueRows(notReady.rows)).toEqual(['pause:engine_turn']);
    expect(notReady.rows.filter((r) => r.event === 'notice')).toEqual([{ event: 'notice', level: 'info', key: `queue:held_after_engine_turn:${head.queueId}`, text: expect.any(String) }]);
    expect((await notReady.store.loadQueue(ID)).paused).toBe(true);

    const failing = await harness({ failWrite: () => true });
    failing.h.turn = true;
    const { entry: failed } = await failing.queue.send('doomed');
    failing.h.turn = false;
    await failing.queue.onTurnEnded(turnEnded({ origin: 'task-notification' }));
    expect(failing.queue.state).toMatchObject({ paused: true, entries: [{ state: 'queued', messageUuid: null }] });
    expect(queueRows(failing.rows)).toEqual(['release:turn_ended', 'pause:engine_turn']);
    expect(notices(failing.rows)).toEqual([`queue:held_after_engine_turn:${failed.queueId}`]);
  });

  it('an engine turn\'s end does nothing with an empty or paused queue', async () => {
    const empty = await harness();
    await empty.queue.onTurnEnded(turnEnded({ origin: 'task-notification' }));
    expect(empty.queue.state).toEqual({ entries: [], paused: false, pauseReason: null }); // C7: pauseReason
    expect(empty.rows).toEqual([]);

    const paused = await harness();
    paused.h.turn = true;
    await paused.queue.send('x');
    await paused.queue.pause('user');
    paused.h.turn = false;
    await paused.queue.onTurnEnded(turnEnded({ origin: 'task-notification' }));
    expect(paused.writes).toEqual([]);
    expect(queueRows(paused.rows)).toEqual(['pause:user']);
    expect(notices(paused.rows)).toEqual([]);
  });

  it('while paused a human turn\'s end releases nothing; setPaused(false) submits the head', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('held back');
    await t.queue.pause('interrupt');
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded());
    expect(t.writes).toEqual([]);
    await t.queue.setPaused(false);
    expect(t.writes.map((w) => w.message.content)).toEqual(['held back']);
    expect(queueRows(t.rows)).toEqual(['pause:interrupt', 'resume:user', 'release:resume']);
  });

  it('a send at an idle session goes behind entries still queued (FIFO), and setPaused(false) at idle releases the head', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('first');
    await t.queue.pause('interrupt');
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded());
    const { disposition } = await t.queue.send('second');
    expect(disposition).toBe('queued');
    expect(t.writes).toEqual([]);
    await t.queue.setPaused(false);
    expect(t.writes.map((w) => w.message.content)).toEqual(['first']);
  });

  it('steer writes priority now at once with an entry still queued; promote steers a queued entry out of the queue', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('queued one');
    await t.queue.send('queued two');
    const { messageUuid } = await t.queue.steer('Stop and reply STEERED');
    expect(t.writes).toEqual([{ type: 'user', uuid: messageUuid, message: { role: 'user', content: 'Stop and reply STEERED' }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: 'now' }]);
    expect(t.queue.state.entries.map((e) => e.state)).toEqual(['queued', 'queued']);

    const target = t.queue.state.entries[1]!;
    const promoted = await t.queue.promote(target.queueId);
    expect(t.writes[1]).toMatchObject({ uuid: promoted.messageUuid, priority: 'now', message: { content: 'queued two' } });
    expect(t.queue.state.entries.map((e) => e.content)).toEqual(['queued one']);
    expect((await t.store.loadQueue(ID)).entries.map((e) => e.content)).toEqual(['queued one']);
  });

  it('edit and remove act on queued entries only', async () => {
    const t = await harness();
    t.h.turn = true;
    const { entry } = await t.queue.send('draft');
    const edited = await t.queue.edit(entry.queueId, 'final');
    expect(edited).toMatchObject({ queueId: entry.queueId, content: 'final' });
    await t.queue.remove(entry.queueId);
    expect(t.queue.state.entries).toEqual([]);
    await expect(t.queue.remove('nope')).rejects.toThrow(/no queued entry/);
    t.h.turn = false;
    const sent = await t.queue.send('now');
    await expect(t.queue.edit(sent.entry.queueId, 'x')).rejects.toThrow(/submitting/);
  });

  it('a submission not acknowledged within 5 s posts one warning notice and stays submitting', async () => {
    vi.useFakeTimers();
    const t = await harness();
    const { entry } = await t.queue.send('one');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(notices(t.rows)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(notices(t.rows)).toEqual([`queue:unacknowledged:${entry.queueId}`]);
    expect(t.queue.state.entries[0]!.state).toBe('submitting');
  });

  it('an acknowledged submission posts no notice', async () => {
    vi.useFakeTimers();
    const t = await harness();
    const { entry } = await t.queue.send('one');
    t.queue.onLifecycle(lifecycle(entry.messageUuid!, 'queued'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(notices(t.rows)).toEqual([]);
  });

  it('refuses content over 1 MiB and sends nothing while the process is not ready', async () => {
    const t = await harness();
    await expect(t.queue.send('x'.repeat(1024 * 1024 + 1))).rejects.toThrow(/1 MiB/);
    t.h.ready = false;
    await expect(t.queue.send('hi')).rejects.toThrow(/not ready/);
    expect(t.writes).toEqual([]);
  });
});

describe('queue submission survives a crash around delivery', () => {
  const entry = (over: Partial<QueueEntry>): QueueEntry => ({
    queueId: 'q-x', appSessionId: ID, content: 'lost?', createdAt: '2026-09-28T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false, ...over,
  });
  const SUBMITTED = '55555555-5555-4555-8555-555555555555' as MessageUuid;

  it('a store holding a submitting entry recovers it as the uncertain head of a paused queue; setPaused(false) writes it exactly once and clears uncertain', async () => {
    const store = new MemorySessionStateStore();
    await store.saveQueue(ID, { entries: [entry({ queueId: 'q-later', content: 'later' }), entry({ queueId: 'q-sub', state: 'submitting', messageUuid: SUBMITTED, submittedAt: '2026-09-28T10:00:01.000Z' })], paused: false });
    const t = await harness({ store, recovered: false });
    await t.queue.recover();
    expect(t.queue.state).toEqual({ paused: true, pauseReason: 'uncertain', entries: [entry({ queueId: 'q-sub', content: 'lost?', uncertain: true }), entry({ queueId: 'q-later', content: 'later' })] }); // C7: pauseReason
    expect(notices(t.rows)).toEqual(['queue:uncertain:q-sub']);
    expect(queueRows(t.rows)).toEqual(['pause:uncertain']);
    expect(await store.loadQueue(ID)).toEqual({ ...t.queue.state, corrupt: null });

    await t.queue.setPaused(false);
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0]).toMatchObject({ message: { content: 'lost?' } });
    expect(t.writes[0]!.uuid).not.toBe(SUBMITTED); // a fresh submission, never a replay of the old uuid
    expect(t.queue.state.entries[0]).toMatchObject({ queueId: 'q-sub', state: 'submitting', uncertain: false });
    await t.queue.setPaused(false);
    expect(t.writes).toHaveLength(1);
  });

  it('a process that exits before recovery leaves the stored queue exactly as it was', async () => {
    const store = new MemorySessionStateStore();
    const stored = { entries: [entry({ state: 'submitting', messageUuid: SUBMITTED, submittedAt: '2026-09-28T10:00:01.000Z' })], paused: false };
    await store.saveQueue(ID, stored);
    const t = await harness({ store, recovered: false });
    await t.queue.onProcessExited('crash');
    expect(await store.loadQueue(ID)).toEqual({ ...stored, corrupt: null });
    expect(t.rows).toEqual([]);
  });

  it('remove drops an uncertain entry and writes nothing', async () => {
    const store = new MemorySessionStateStore();
    await store.saveQueue(ID, { entries: [entry({ state: 'submitting', messageUuid: SUBMITTED, submittedAt: '2026-09-28T10:00:01.000Z' })], paused: false });
    const t = await harness({ store, recovered: false });
    await t.queue.recover();
    await t.queue.remove('q-x');
    expect(t.queue.state.entries).toEqual([]);
    expect(t.writes).toEqual([]);
  });

  it('a released entry the process leaves without its turn.ended retires interrupted at the exit: gone from the store, a notice, nothing written, not busy', async () => {
    const t = await harness();
    const { entry: sent } = await t.queue.send('accepted then lost');
    t.queue.onLifecycle(lifecycle(sent.messageUuid!, 'queued'));
    t.h.turn = false; // the dead process's normaliser no longer holds the turn open for the resumed one
    t.h.ready = false;
    const writesBefore = t.writes.length;
    await t.queue.onProcessExited('crash');
    expect(t.queue.state.entries).toEqual([]);
    expect(t.queue.busy).toBe(false);
    expect((await t.store.loadQueue(ID)).entries).toEqual([]);
    expect(notices(t.rows)).toEqual([`queue:interrupted:${sent.queueId}`]);
    expect(t.writes).toHaveLength(writesBefore);

    // the resumed process's queue, over the same store
    const resumed = await harness({ store: t.store, recovered: false });
    await resumed.queue.recover();
    expect((await resumed.queue.send('next')).disposition).toBe('sent');
  });

  it('a store holding a released entry retires it at recovery with the same notice, never re-submitting it', async () => {
    const store = new MemorySessionStateStore();
    await store.saveQueue(ID, { entries: [entry({ state: 'released', messageUuid: SUBMITTED, submittedAt: '2026-09-28T10:00:01.000Z' })], paused: false });
    const t = await harness({ store, recovered: false });
    await t.queue.recover();
    expect(t.queue.state).toEqual({ entries: [], paused: false, pauseReason: null }); // C7: pauseReason
    expect(notices(t.rows)).toEqual(['queue:interrupted:q-x']);
    expect(t.writes).toEqual([]);
    expect(t.queue.busy).toBe(false);
  });

  it('a released entry its turn.ended named before the exit leaves nothing behind and no notice', async () => {
    const t = await harness();
    const { entry: sent } = await t.queue.send('answered');
    t.queue.onLifecycle(lifecycle(sent.messageUuid!, 'queued'));
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ userMessageUuids: [sent.messageUuid!] }));
    await t.queue.onProcessExited('stop');
    expect(t.queue.state).toEqual({ entries: [], paused: false, pauseReason: null }); // C7: pauseReason
    expect(notices(t.rows)).toEqual([]);
  });

  it('a submitting entry at the exit takes the recovery path: queued at the head, uncertain, paused', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('queued first');
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded());
    const submitting = t.queue.state.entries[0]!;
    expect(submitting.state).toBe('submitting');
    await t.queue.onProcessExited('crash');
    expect(t.queue.state).toEqual({ paused: true, pauseReason: 'uncertain', entries: [{ ...submitting, state: 'queued', messageUuid: null, submittedAt: null, uncertain: true }] }); // C7: pauseReason
    expect(notices(t.rows)).toEqual([`queue:uncertain:${submitting.queueId}`]);
  });

  it('an exit nobody asked for pauses the queue; a requested stop leaves queued entries as they were', async () => {
    const crashed = await harness();
    crashed.h.turn = true;
    await crashed.queue.send('waiting');
    await crashed.queue.onProcessExited('crash');
    expect(crashed.queue.state).toMatchObject({ paused: true, entries: [{ state: 'queued', uncertain: false }] });

    const stopped = await harness();
    stopped.h.turn = true;
    await stopped.queue.send('waiting');
    await stopped.queue.onProcessExited('stop');
    expect(stopped.queue.state).toMatchObject({ paused: false, entries: [{ state: 'queued' }] });
  });

  it('a write that fails reverts the entry to queued and pauses the queue', async () => {
    const t = await harness({ failWrite: () => true });
    const { disposition, entry: sent } = await t.queue.send('doomed');
    expect(disposition).toBe('queued');
    expect(sent).toMatchObject({ state: 'queued', messageUuid: null, submittedAt: null });
    expect(t.queue.state.paused).toBe(true);
    expect(queueRows(t.rows)).toEqual(['release:send', 'pause:write_failed']);
    expect(await t.store.loadQueue(ID)).toEqual({ ...t.queue.state, corrupt: null });
  });

  it('an exit while a submission\'s write is in flight wins: the late failure does not undo the recovery', async () => {
    const t = await harness({ holdWrites: true, failWrite: () => true });
    const sending = t.queue.send('in flight');
    await flush();
    await t.queue.onProcessExited('crash');
    t.held.shift()!();
    await sending;
    expect(t.queue.state.entries).toMatchObject([{ state: 'queued', uncertain: true }]);
    expect(queueRows(t.rows).filter((r) => r === 'pause:write_failed')).toEqual([]);
  });
});

describe('queue persistence is never assumed (M4 review)', () => {
  const failSaves = (store: MemorySessionStateStore) => {
    store.saveQueue = async () => {
      throw new Error('EIO: i/o error');
    };
  };

  it('an idle send whose save fails writes no frame, answers queued, pauses (store_failed) with a warning notice, and announces nothing as durable', async () => {
    const t = await harness();
    const announced = t.changes.length;
    failSaves(t.store);
    const { disposition, entry } = await t.queue.send('not durable');
    expect(disposition).toBe('queued');
    expect(entry).toMatchObject({ state: 'queued', messageUuid: null, submittedAt: null });
    expect(t.writes).toEqual([]);
    expect(t.storeAtWrite).toEqual([]);
    expect(t.queue.state.paused).toBe(true);
    expect(queueRows(t.rows)).toEqual(['pause:store_failed']);
    expect(t.rows.filter((r) => r.event === 'notice')).toEqual([{ event: 'notice', level: 'warning', key: `queue:store_failed:${entry.queueId}`, text: expect.stringContaining('EIO') }]);
    expect(t.changes.length).toBe(announced); // no onChange for a save that did not land
  });

  it('a send queued behind a turn whose save fails is kept in memory, paused with the same notice', async () => {
    const t = await harness();
    t.h.turn = true;
    failSaves(t.store);
    const { disposition, entry } = await t.queue.send('behind');
    expect(disposition).toBe('queued');
    expect(t.queue.state).toMatchObject({ paused: true, entries: [{ queueId: entry.queueId, state: 'queued' }] });
    expect(notices(t.rows)).toEqual([`queue:store_failed:${entry.queueId}`]);
  });

  it('a release at a turn\'s end whose save fails writes nothing and pauses', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('waiting');
    failSaves(t.store);
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded());
    expect(t.writes).toEqual([]);
    expect(t.queue.state).toMatchObject({ paused: true, entries: [{ state: 'queued', messageUuid: null }] });
    expect(queueRows(t.rows)).toEqual(['pause:store_failed']);
  });

  it('edit and remove whose save fails reject and leave the queue as it was', async () => {
    const t = await harness();
    t.h.turn = true;
    const { entry } = await t.queue.send('draft');
    failSaves(t.store);
    await expect(t.queue.edit(entry.queueId, 'final')).rejects.toThrow('EIO');
    await expect(t.queue.remove(entry.queueId)).rejects.toThrow('EIO');
    expect(t.queue.state.entries).toMatchObject([{ queueId: entry.queueId, content: 'draft', state: 'queued' }]);
  });

  it('a recovery whose load reports a corrupt state file starts paused with a warning notice naming the kept file', async () => {
    const store = new MemorySessionStateStore();
    store.loadQueue = async () => ({ entries: [], paused: false, corrupt: '/u/engine-host/state/app-q.json.corrupt-1' });
    const t = await harness({ store });
    expect(t.queue.state.paused).toBe(true);
    expect(queueRows(t.rows)).toEqual(['pause:state_corrupt']);
    expect(t.rows.filter((r) => r.event === 'notice')).toEqual([{ event: 'notice', level: 'warning', key: `state:corrupt:${ID}`, text: expect.stringContaining('/u/engine-host/state/app-q.json.corrupt-1') }]);
  });

  it('a recovery whose save fails rejects (the session treats it as an initialization failure)', async () => {
    const store = new MemorySessionStateStore();
    failSaves(store);
    await expect(harness({ store })).rejects.toThrow('EIO');
  });
});

describe('promote is a durable submission (M4 review)', () => {
  it('the entry is persisted as a submitting steer before the write and removed only after the flush', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('first');
    const { entry } = await t.queue.send('promote me');
    const { messageUuid } = await t.queue.promote(entry.queueId);
    expect(t.writes.at(-1)).toMatchObject({ uuid: messageUuid, priority: 'now', message: { content: 'promote me' } });
    expect(t.storeAtWrite.at(-1)!.entries.find((e) => e.queueId === entry.queueId)).toMatchObject({ state: 'submitting', steer: true, messageUuid });
    expect(t.queue.state.entries.map((e) => e.content)).toEqual(['first']);
    expect((await t.store.loadQueue(ID)).entries.map((e) => e.content)).toEqual(['first']);
  });

  it("writes the priority it is given, 'now' by default and 'next' on request (C7's composer)", async () => {
    const t = await harness();
    t.h.turn = true;
    const { entry: a } = await t.queue.send('default');
    const { entry: b } = await t.queue.send('fold in');
    const byDefault = await t.queue.promote(a.queueId);
    const next = await t.queue.promote(b.queueId, { priority: 'next' });
    expect(t.writes.map((w) => [w.uuid, w.message.content, w.priority])).toEqual([[byDefault.messageUuid, 'default', 'now'], [next.messageUuid, 'fold in', 'next']]);
    expect(t.queue.state.entries).toEqual([]);
  });

  it('a crash before the flush recovers the promoted entry through the uncertain path', async () => {
    const t = await harness({ holdWrites: true, failWrite: () => true });
    t.h.turn = true;
    const { entry } = await t.queue.send('promote me');
    const promoting = t.queue.promote(entry.queueId);
    await flush();
    await t.queue.onProcessExited('crash');
    t.held.shift()!();
    await expect(promoting).rejects.toThrow('EPIPE');
    expect(t.queue.state).toMatchObject({ paused: true, entries: [{ queueId: entry.queueId, state: 'queued', uncertain: true, steer: false, messageUuid: null }] });
    expect(notices(t.rows)).toEqual([`queue:uncertain:${entry.queueId}`]);
  });

  it('a crash after the flush, before the removal is saved, leaves a submitting steer the next process recovers as uncertain', async () => {
    const t = await harness();
    t.h.turn = true;
    const { entry } = await t.queue.send('promote me');
    const realSave = t.store.saveQueue.bind(t.store);
    let saves = 0;
    t.store.saveQueue = (id, q) => (++saves === 1 ? realSave(id, q) : new Promise<void>(() => {})); // the host dies during the removal save
    void t.queue.promote(entry.queueId);
    await flush();
    expect(t.writes.at(-1)).toMatchObject({ priority: 'now' });
    expect((await t.store.loadQueue(ID)).entries).toMatchObject([{ queueId: entry.queueId, state: 'submitting', steer: true }]);

    const next = await harness({ store: t.store, recovered: false });
    next.store.saveQueue = realSave;
    await next.queue.recover();
    expect(next.queue.state).toMatchObject({ paused: true, entries: [{ queueId: entry.queueId, state: 'queued', uncertain: true, steer: false }] });
  });

  it('a failed steer write puts the entry back as queued in its place and rejects', async () => {
    const t = await harness({ failWrite: (f) => f.priority === 'now' });
    t.h.turn = true;
    await t.queue.send('a');
    const { entry } = await t.queue.send('b');
    await t.queue.send('c');
    await expect(t.queue.promote(entry.queueId)).rejects.toThrow('EPIPE');
    expect(t.queue.state.entries.map((e) => [e.content, e.state, e.steer, e.messageUuid])).toEqual([['a', 'queued', false, null], ['b', 'queued', false, null], ['c', 'queued', false, null]]);
    expect(await t.store.loadQueue(ID)).toMatchObject({ entries: [{ content: 'a' }, { content: 'b', state: 'queued', steer: false }, { content: 'c' }] });
    expect(t.queue.state.paused).toBe(false);
  });
});

// C7 start: why the queue is paused (C7 execution document, Decision Log "execution start 2026-09-29" item 2 and the
// architect's ruling on it): every pause carries its reason in the state, the change, the store and a reload; resume clears it.
describe('queue pause reasons (C7)', () => {
  const lastPauseRow = (rows: Record<string, unknown>[]) => rows.filter((r) => r.event === 'queue' && r.action === 'pause').at(-1)?.reason ?? null;
  // The reason the queue holds is the one it journaled, everywhere it is published.
  async function expectReason(t: Awaited<ReturnType<typeof harness>>, reason: string) {
    await t.queue.settled();
    expect(lastPauseRow(t.rows)).toBe(reason);
    expect(t.queue.state).toMatchObject({ paused: true, pauseReason: reason });
    expect(t.changes.at(-1)).toMatchObject({ paused: true, pauseReason: reason });
    expect(await t.store.loadQueue(ID)).toMatchObject({ paused: true, pauseReason: reason });
  }

  it('an unpaused queue has a null reason; interrupt and user pauses carry theirs; resume clears it everywhere', async () => {
    const t = await harness();
    expect(t.queue.state).toEqual({ entries: [], paused: false, pauseReason: null });
    t.h.turn = true;
    await t.queue.send('waiting');
    await t.queue.pause('interrupt');
    await expectReason(t, 'interrupt');
    await t.queue.setPaused(false);
    expect(t.queue.state).toMatchObject({ paused: false, pauseReason: null });
    expect(t.changes.at(-1)).toMatchObject({ paused: false, pauseReason: null });
    expect(await t.store.loadQueue(ID)).toMatchObject({ paused: false, pauseReason: null });
    await t.queue.setPaused(true);
    await expectReason(t, 'user');
    await t.queue.pause('interrupt'); // already paused: the first reason stands, as the journal says
    await expectReason(t, 'user');
  });

  it('every host pause path records the reason it journals', async () => {
    const failing = await harness({ failWrite: () => true });
    await failing.queue.send('doomed');
    await expectReason(failing, 'write_failed');

    const refused = await harness();
    const { entry: sent } = await refused.queue.send('one');
    await refused.queue.send('two');
    refused.queue.onLifecycle(lifecycle(sent.messageUuid!, 'refused'));
    await expectReason(refused, 'refused');

    const crashed = await harness();
    crashed.h.turn = true;
    await crashed.queue.send('waiting');
    await crashed.queue.onProcessExited('crash');
    await expectReason(crashed, 'exit');

    const engine = await harness();
    engine.h.turn = true;
    await engine.queue.send('held');
    engine.h.turn = false;
    engine.h.ready = false;
    await engine.queue.onTurnEnded(turnEnded({ origin: 'task-notification' }));
    await expectReason(engine, 'engine_turn');

    const stored = new MemorySessionStateStore();
    const unsaved = await harness({ store: stored });
    unsaved.h.turn = true;
    const realSave = stored.saveQueue.bind(stored);
    stored.saveQueue = async () => Promise.reject(new Error('ENOSPC'));
    const { entry: kept } = await unsaved.queue.send('unsaved');
    stored.saveQueue = realSave;
    await unsaved.queue.edit(kept.queueId, 'unsaved'); // the next save lands, reason and all
    await expectReason(unsaved, 'store_failed');

    const corrupt = new MemorySessionStateStore();
    const realLoad = corrupt.loadQueue.bind(corrupt);
    corrupt.loadQueue = async () => {
      corrupt.loadQueue = realLoad; // corrupt once, at the recovery's load
      return { entries: [], paused: false, corrupt: '/u/engine-host/state/app-q.json.corrupt-1' };
    };
    await expectReason(await harness({ store: corrupt }), 'state_corrupt');

    const uncertainStore = new MemorySessionStateStore();
    await uncertainStore.saveQueue(ID, { entries: [{ queueId: 'q-sub', appSessionId: ID, content: 'lost?', createdAt: '2026-09-28T10:00:00.000Z', state: 'submitting', messageUuid: '55555555-5555-4555-8555-555555555555' as MessageUuid, submittedAt: '2026-09-28T10:00:01.000Z', uncertain: false, steer: false }], paused: false, pauseReason: null });
    await expectReason(await harness({ store: uncertainStore }), 'uncertain');
  });

  it('the reason survives a reload through the store; a state saved before the field existed loads paused with a null reason', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('waiting');
    await t.queue.pause('interrupt');
    const next = await harness({ store: t.store });
    expect(next.queue.state).toMatchObject({ paused: true, pauseReason: 'interrupt' });

    const legacy = new MemorySessionStateStore();
    await legacy.saveQueue(ID, { entries: [], paused: true });
    const old = await harness({ store: legacy });
    expect(old.queue.state).toEqual({ entries: [], paused: true, pauseReason: null });
    await old.queue.setPaused(false);
    expect(old.queue.state).toEqual({ entries: [], paused: false, pauseReason: null });
  });
});
// C7 end

// W1: the Enter scheme. A `next` steer is a pending steer until the engine starts or drops it; "Hold until the turn
// ends" withdraws it from the engine (`cancel_async_message`, pass3/steer-next-cancelled) into the app queue's end.
describe('pending steers and hold (W1)', () => {
  it('a next steer is published as pending, and leaves at its started (folded into the turn) or its drop', async () => {
    const t = await harness();
    t.h.turn = true;
    const { messageUuid } = await t.queue.steer('look at b too', { priority: 'next' });
    expect(t.writes.at(-1)).toMatchObject({ uuid: messageUuid, priority: 'next' });
    expect(t.queue.state.steers).toEqual([{ messageUuid, content: 'look at b too', createdAt: expect.any(String) }]);
    expect(t.changes.at(-1)?.steers?.map((s) => s.messageUuid)).toEqual([messageUuid]);
    t.queue.onLifecycle(lifecycle(messageUuid, 'queued'));
    expect(t.queue.state.steers).toHaveLength(1); // queued is still waiting
    t.queue.onLifecycle(lifecycle(messageUuid, 'started'));
    await flush();
    expect(t.queue.state.steers).toBeUndefined();
    const now = await t.queue.steer('stop', { priority: 'now' });
    expect(t.queue.state.steers).toBeUndefined(); // a now steer preempts at once: nothing to hold
    expect(now.messageUuid).toBeTruthy();
  });

  // E1 M2 fix wave: an async ask's `maws_ask_answered` row rides its steer's write, journaled only with a successful one
  it('a steer hands its preface rows to the write, and a plain steer hands none', async () => {
    const t = await harness();
    const preface = [{ event: 'maws_ask_answered', askId: 'toolu_1' }];
    await t.queue.steer('the answers', { priority: 'next', preface });
    await t.queue.steer('plain', { priority: 'next' });
    expect(t.prefaces.slice(-2)).toEqual([preface, undefined]);
  });

  it('hold withdraws the pending steer and appends it to the app queue, remembering its uuid; the turn end releases it', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('held first');
    const { messageUuid } = await t.queue.steer('then this', { priority: 'next' });
    const entry = await t.queue.hold(messageUuid);
    expect(t.cancels).toEqual([messageUuid]);
    expect(entry).toMatchObject({ state: 'queued', content: 'then this', messageUuid: null });
    expect(t.queue.state.entries.map((e) => e.content)).toEqual(['held first', 'then this']);
    expect(t.queue.state).toMatchObject({ withdrawn: [messageUuid] });
    expect(t.queue.state.steers).toBeUndefined();
    expect(queueRows(t.rows)).toContain('hold:undefined');
    expect((await t.store.loadQueue(ID)).withdrawn).toEqual([messageUuid]); // a restart still knows it was held, not lost
    t.queue.onLifecycle(lifecycle(messageUuid, 'cancelled')); // the engine's own report of the withdrawal changes nothing more
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ origin: 'human' }));
    expect(t.writes.at(-1)).toMatchObject({ message: { content: 'held first' } });
  });

  it('hold is refused once the engine has taken the steer, and leaves nothing behind', async () => {
    const t = await harness();
    t.h.turn = true;
    const { messageUuid } = await t.queue.steer('late', { priority: 'next' });
    t.h.cancelled = false; // folded into the turn at that very moment: the engine had nothing to withdraw
    await expect(t.queue.hold(messageUuid)).rejects.toThrow('already reached the running turn');
    expect(t.queue.state.entries).toEqual([]);
    expect(t.queue.state.withdrawn).toBeUndefined();
    t.queue.onLifecycle(lifecycle(messageUuid, 'started'));
    await expect(t.queue.hold(messageUuid)).rejects.toThrow('already reached the running turn');
    expect(t.cancels).toEqual([messageUuid]); // the second refusal never asked the engine
  });

  it('a hold whose running turn ends during the withdrawal releases the held message at once: that turn end had nothing to release (W1 review)', async () => {
    const t = await harness();
    t.h.turn = true;
    const { messageUuid } = await t.queue.steer('then this', { priority: 'next' });
    let answer!: () => void;
    t.h.cancelAnswer = new Promise<void>((resolve) => (answer = resolve));
    const holding = t.queue.hold(messageUuid);
    await flush();
    expect(t.cancels).toEqual([messageUuid]);
    t.queue.onLifecycle(lifecycle(messageUuid, 'cancelled')); // withdrawn; the running turn then ends before the answer arrives
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ origin: 'human' }));
    expect(t.writes).toHaveLength(1); // the steer only: nothing was queued yet
    answer();
    const entry = await holding;
    expect(t.writes.at(-1)).toEqual({ type: 'user', uuid: entry.messageUuid, message: { role: 'user', content: 'then this' }, parent_tool_use_id: null, origin: { kind: 'human' } });
    expect(t.queue.state.entries).toMatchObject([{ queueId: entry.queueId, state: 'submitting' }]);
    expect(queueRows(t.rows)).toEqual(['hold:undefined', 'release:hold']);
  });

  it('a next steer is pending from before its write, so a lifecycle the writer\'s settle drains before the write resolves ends it (steer and promote; W1 review)', async () => {
    for (const state of ['started', 'completed', 'cancelled', 'refused'] as const) {
      const t = await harness();
      t.h.turn = true;
      const { entry } = await t.queue.send('queued');
      const atWrite: (MessageUuid[] | undefined)[] = [];
      t.h.onWrite = (frame) => {
        atWrite.push(t.queue.state.steers?.map((s) => s.messageUuid));
        t.queue.onLifecycle(lifecycle(frame.uuid as MessageUuid, state));
      };
      const steered = await t.queue.steer('look at b too', { priority: 'next' });
      const promoted = await t.queue.promote(entry.queueId, { priority: 'next' });
      await flush();
      expect(atWrite).toEqual([[steered.messageUuid], [promoted.messageUuid]]);
      expect(t.queue.state.steers).toBeUndefined();
      expect(t.changes.at(-1)?.steers).toBeUndefined();
    }
  });

  it('a next steer whose write fails is taken back (steer and promote; W1 review)', async () => {
    const t = await harness({ holdWrites: true, failWrite: () => true });
    t.h.turn = true;
    const { entry } = await t.queue.send('queued');
    const steering = t.queue.steer('look at b too', { priority: 'next' });
    await flush();
    expect(t.queue.state.steers).toHaveLength(1); // registered while the write is in flight
    t.held.shift()!();
    await expect(steering).rejects.toThrow('EPIPE');
    expect(t.queue.state.steers).toBeUndefined();
    const promoting = t.queue.promote(entry.queueId, { priority: 'next' });
    await flush();
    expect(t.queue.state.steers).toHaveLength(1);
    t.held.shift()!();
    await expect(promoting).rejects.toThrow('EPIPE');
    expect(t.queue.state).toMatchObject({ entries: [{ queueId: entry.queueId, state: 'queued' }] });
    expect(t.queue.state.steers).toBeUndefined();
    expect(t.changes.at(-1)?.steers).toBeUndefined();
  });

  it('pending steers go with the process; a promoted entry steered next is pending too', async () => {
    const t = await harness();
    t.h.turn = true;
    const { entry } = await t.queue.send('queued');
    const { messageUuid } = await t.queue.promote(entry.queueId, { priority: 'next' });
    expect(t.queue.state.steers?.map((s) => [s.messageUuid, s.content])).toEqual([[messageUuid, 'queued']]);
    await t.queue.onProcessExited('quit');
    expect(t.queue.state.steers).toBeUndefined();
  });
});

// W1: the plain stop (⌘., the Stop button, a route switch) holds every waiting `next` steer before the interrupt, so
// nothing runs after it; the session pauses the queue first (conformance/queue.test.ts pins the order on the wire).
describe('holdAll, the plain stop’s hold (W1)', () => {
  it('withdraws every waiting steer in write order into the paused queue’s end; the interrupted turn’s end releases nothing', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('held first');
    const a = (await t.queue.steer('steer a', { priority: 'next' })).messageUuid;
    const b = (await t.queue.steer('steer b', { priority: 'next' })).messageUuid;
    await t.queue.pause('interrupt');
    const held = await t.queue.holdAll();
    expect(t.cancels).toEqual([a, b]);
    expect(held.map((e) => e.content)).toEqual(['steer a', 'steer b']);
    expect(t.queue.state).toMatchObject({ paused: true, pauseReason: 'interrupt', withdrawn: [a, b] });
    expect(t.queue.state.entries.map((e) => [e.content, e.state])).toEqual([['held first', 'queued'], ['steer a', 'queued'], ['steer b', 'queued']]);
    expect(t.queue.state.steers).toBeUndefined();
    expect((await t.store.loadQueue(ID)).entries.map((e) => e.content)).toEqual(['held first', 'steer a', 'steer b']);
    const written = t.writes.length;
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ origin: 'human' }));
    expect(t.writes).toHaveLength(written); // paused: nothing runs until Resume or Send now
    await t.queue.setPaused(false);
    expect(t.writes.at(-1)).toMatchObject({ message: { content: 'held first' } });
  });

  it('a steer the engine starts between the list and its cancel stays the engine’s, never duplicated; a failed cancel leaves its steer too', async () => {
    const t = await harness();
    t.h.turn = true;
    const a = (await t.queue.steer('steer a', { priority: 'next' })).messageUuid;
    const b = (await t.queue.steer('steer b', { priority: 'next' })).messageUuid;
    const c = (await t.queue.steer('steer c', { priority: 'next' })).messageUuid;
    t.h.cancelFor = (uuid) => {
      if (uuid === a) {
        t.queue.onLifecycle(lifecycle(a, 'started')); // folded into the turn at that very moment
        return false;
      }
      if (uuid === c) throw new Error('control timeout');
      return true;
    };
    await t.queue.pause('interrupt');
    const held = await t.queue.holdAll();
    expect(t.cancels).toEqual([a, b, c]);
    expect(held.map((e) => e.content)).toEqual(['steer b']);
    expect(t.queue.state.entries.map((e) => e.content)).toEqual(['steer b']);
    expect(t.queue.state.withdrawn).toEqual([b]);
    expect(t.queue.state.steers?.map((s) => s.messageUuid)).toEqual([c]); // still the engine's
  });

  it('with nothing waiting it asks the engine nothing and saves nothing', async () => {
    const t = await harness();
    const saves = t.changes.length;
    expect(await t.queue.holdAll()).toEqual([]);
    expect(t.cancels).toEqual([]);
    expect(t.changes).toHaveLength(saves);
  });

  it('the withdrawals share one deadline: an unanswered cancel lets the stop go on at it, no further cancel starts, and the late answer is still held and saved (W1 review)', async () => {
    vi.useFakeTimers();
    const t = await harness({ holdAllDeadlineMs: 2_000 });
    t.h.turn = true;
    const a = (await t.queue.steer('steer a', { priority: 'next' })).messageUuid;
    const b = (await t.queue.steer('steer b', { priority: 'next' })).messageUuid;
    let answer!: () => void;
    t.h.cancelAnswer = new Promise<void>((resolve) => (answer = resolve));
    await t.queue.pause('interrupt');
    let held: QueueEntry[] | null = null;
    const holding = t.queue.holdAll().then((entries) => (held = entries));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(held).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await holding;
    expect(held).toEqual([]);
    expect(t.cancels).toEqual([a]); // b's cancel never started: b stays the engine's
    expect(t.queue.state.steers?.map((s) => s.messageUuid)).toEqual([a, b]);
    expect(t.queue.state.withdrawn).toEqual([a]); // a's withdrawal is still in flight
    expect((await t.store.loadQueue(ID)).withdrawn).toEqual([a]);
    const written = t.writes.length;
    t.queue.onLifecycle(lifecycle(a, 'cancelled')); // the engine withdraws it, then answers
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.queue.state.entries.map((e) => [e.content, e.state])).toEqual([['steer a', 'queued']]);
    expect(t.queue.state.steers?.map((s) => s.messageUuid)).toEqual([b]);
    expect(t.queue.state.withdrawn).toEqual([a]);
    expect((await t.store.loadQueue(ID)).entries.map((e) => e.content)).toEqual(['steer a']);
    expect(queueRows(t.rows)).toContain('hold:undefined');
    expect(t.writes).toHaveLength(written); // paused: nothing released
  });

  it('each withdrawn steer is saved as a held entry before the next cancel goes out (W1 review)', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.steer('steer a', { priority: 'next' });
    await t.queue.steer('steer b', { priority: 'next' });
    const onDisk: unknown[][] = [];
    t.h.cancelFor = async () => {
      onDisk.push((await t.store.loadQueue(ID)).entries.map((e) => e.content)); // what a crash during this cancel would leave
      return true;
    };
    await t.queue.pause('interrupt');
    await t.queue.holdAll();
    expect(onDisk).toEqual([[], ['steer a']]);
  });

  it('a second stop while the first withdraws a steer leaves it to the first: one cancel, one held entry, its marker kept (W1 review)', async () => {
    const t = await harness();
    t.h.turn = true;
    const a = (await t.queue.steer('steer a', { priority: 'next' })).messageUuid;
    let answer!: () => void;
    t.h.cancelAnswer = new Promise<void>((resolve) => (answer = resolve));
    let given = 0;
    t.h.cancelFor = () => given++ === 0; // the engine gives a message back once
    await t.queue.pause('interrupt');
    const first = t.queue.holdAll();
    await flush();
    expect(await t.queue.holdAll()).toEqual([]);
    answer();
    expect((await first).map((e) => e.content)).toEqual(['steer a']);
    expect(t.cancels).toEqual([a]);
    expect(t.queue.state.entries.map((e) => e.content)).toEqual(['steer a']);
    expect(t.queue.state.withdrawn).toEqual([a]);
    expect((await t.store.loadQueue(ID)).withdrawn).toEqual([a]);
  });

  it('a hold and a stop on the same steer: the stop leaves a held one to the hold, and a hold is refused while the stop withdraws it (W1 review)', async () => {
    for (const holdFirst of [true, false]) {
      const t = await harness();
      t.h.turn = true;
      const a = (await t.queue.steer('steer a', { priority: 'next' })).messageUuid;
      let answer!: () => void;
      t.h.cancelAnswer = new Promise<void>((resolve) => (answer = resolve));
      let given = 0;
      t.h.cancelFor = () => given++ === 0;
      if (holdFirst) {
        const holding = t.queue.hold(a);
        await flush();
        await t.queue.pause('interrupt');
        expect(await t.queue.holdAll()).toEqual([]);
        answer();
        expect((await holding).content).toBe('steer a');
      } else {
        await t.queue.pause('interrupt');
        const stopping = t.queue.holdAll();
        await flush();
        await expect(t.queue.hold(a)).rejects.toThrow('already being held');
        answer();
        expect((await stopping).map((e) => e.content)).toEqual(['steer a']);
      }
      expect(t.cancels).toEqual([a]);
      expect(t.queue.state.entries.map((e) => e.content)).toEqual(['steer a']);
      expect(t.queue.state.withdrawn).toEqual([a]);
      expect((await t.store.loadQueue(ID)).withdrawn).toEqual([a]);
    }
  });
});


describe('F2 paused queue admission', () => {
  it('turn completion and another Resume cannot release an ordinary head before Resume is durable', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('ordinary prompt');
    await t.queue.pause('interrupt');
    t.h.turn = false;
    let failResume!: () => void;
    const held = new Promise<void>((resolve) => { failResume = resolve; });
    vi.spyOn(t.store, 'saveQueue').mockImplementationOnce(async () => {
      await held;
      throw new Error('EIO');
    });
    const resuming = t.queue.setPaused(false).catch((error: unknown) => error);
    await t.queue.onTurnEnded(turnEnded());
    await t.queue.setPaused(false);
    expect(t.writes).toEqual([]);
    failResume();
    expect(await resuming).toMatchObject({ message: 'EIO' });
    expect(t.queue.isPaused).toBe(true);
    await t.queue.setPaused(false);
    expect(t.writes.map((w) => w.message.content)).toEqual(['ordinary prompt']);
  });

  it('a send into an empty interrupted queue stays persisted until Resume', async () => {
    const t = await harness();
    await t.queue.pause('interrupt');
    const sent = await t.queue.send('after Stop');
    expect(sent.disposition).toBe('queued');
    expect(t.writes).toEqual([]);
    expect(await t.store.loadQueue(ID)).toMatchObject({ paused: true, entries: [{ content: 'after Stop', state: 'queued' }] });
    await t.queue.setPaused(false);
    expect(t.writes.map((w) => w.message.content)).toEqual(['after Stop']);
  });
});

// P2-C start (2026-10-09; the P2-C document, Design §6's row table and M3): the host states each transition of a prompt
// through its queue as one `meta queue` row, at the transition, before the change is published; the normaliser reads
// each as a `queue.transition`. Rows are read here through a real Normalizer, as the session's record path reads them.
type Transition = { action: string; queueId: string | null; messageUuid: string | null; reason: string | null };
type Timeline = Awaited<ReturnType<typeof harness>>['timeline'];
const transitions = (rows: Record<string, unknown>[]): Transition[] => {
  const normalizer = new Normalizer({ appSessionId: ID, launchId: 'L1', sessionId: null });
  return rows
    .flatMap((frame, i) => normalizer.push({ seq: i + 1, direction: 'meta', at: base.at, frame }))
    .map((event) => SessionEventSchema.parse(event))
    .flatMap((event) => (event.kind === 'queue.transition' ? [{ action: event.action, queueId: event.queueId, messageUuid: event.messageUuid, reason: event.reason }] : []));
};
const tr = (action: string, queueId: string | null, messageUuid: unknown, reason: string | null = null) => ({ action, queueId, messageUuid, reason });
// the index of the first row of `action` naming `id` (as its uuid or its entry), and of the first published change `shows` matches
const rowAt = (timeline: Timeline, action: string, id: string) => timeline.findIndex((e) => 'row' in e && e.row.action === action && (e.row.messageUuid === id || e.row.queueId === id));
const changeAt = (timeline: Timeline, shows: (q: QueueState) => boolean, from = 0) => timeline.findIndex((e, i) => i >= from && 'change' in e && shows(e.change));
// the first published change without entry `queueId` once a change had shown it
const goneAt = (timeline: Timeline, queueId: string) => changeAt(timeline, (q) => !q.entries.some((e) => e.queueId === queueId), changeAt(timeline, (q) => q.entries.some((e) => e.queueId === queueId)));
const failingSaves = (store: MemorySessionStateStore) => {
  store.saveQueue = async () => {
    throw new Error('EIO: i/o error');
  };
};

describe('the prompt record: each transition one row and one queue.transition (P2-C)', () => {
  it('release: an idle send is submitted as one row naming its entry and uuid', async () => {
    const t = await harness();
    const { entry } = await t.queue.send('one');
    expect(transitions(t.rows)).toEqual([tr('release', entry.queueId, entry.messageUuid)]);
  });

  it('revert: a submission whose persist fails, or whose write fails, names the uuid that never reached the engine', async () => {
    const persisted = await harness();
    failingSaves(persisted.store);
    const { entry: notSaved } = await persisted.queue.send('not durable');
    expect(transitions(persisted.rows)).toEqual([tr('revert', notSaved.queueId, expect.any(String))]);
    expect(persisted.writes).toEqual([]);

    const written = await harness({ failWrite: () => true });
    const { entry: doomed } = await written.queue.send('doomed');
    const uuid = transitions(written.rows)[0]!.messageUuid;
    expect(transitions(written.rows)).toEqual([tr('release', doomed.queueId, uuid), tr('revert', doomed.queueId, uuid)]);
    expect(rowAt(written.timeline, 'revert', doomed.queueId)).toBeLessThan(changeAt(written.timeline, (q) => q.paused && q.entries.some((e) => e.queueId === doomed.queueId && e.state === 'queued')));
  });

  it('uncertain at an exit for a submission it cut; a late write failure states nothing more', async () => {
    const t = await harness({ holdWrites: true, failWrite: () => true });
    const sending = t.queue.send('in flight');
    await flush();
    const submitting = t.queue.state.entries[0]!;
    const before = t.rows.length;
    await t.queue.onProcessExited('crash');
    t.held.shift()!();
    await sending;
    expect(transitions(t.rows.slice(before))).toEqual([tr('uncertain', submitting.queueId, submitting.messageUuid)]);
  });

  it('abandon and retire at an exit: each pending steer first, then each released entry', async () => {
    const t = await harness();
    const { entry } = await t.queue.send('accepted');
    t.queue.onLifecycle(lifecycle(entry.messageUuid!, 'queued'));
    t.h.turn = true;
    const { messageUuid: steer } = await t.queue.steer('fold this in', { priority: 'next' });
    const before = t.rows.length;
    await t.queue.onProcessExited('crash');
    expect(transitions(t.rows.slice(before))).toEqual([tr('abandon', null, steer), tr('retire', entry.queueId, entry.messageUuid)]);
    expect(t.queue.state.steers).toBeUndefined();
  });

  it("abandon at a recovery holding a dead process's pending steers, before the uncertain row of its stored submission", async () => {
    const store = new MemorySessionStateStore();
    const STEER = '66666666-6666-4666-8666-666666666666' as MessageUuid;
    const SUBMITTED = '55555555-5555-4555-8555-555555555555' as MessageUuid;
    await store.saveQueue(ID, {
      entries: [{ queueId: 'q-sub', appSessionId: ID, content: 'lost?', createdAt: base.at, state: 'submitting', messageUuid: SUBMITTED, submittedAt: base.at, uncertain: false, steer: false }],
      paused: false, steers: [{ messageUuid: STEER, content: 'fold this in', createdAt: base.at }],
    });
    const t = await harness({ store, recovered: false });
    await t.queue.recover();
    expect(transitions(t.rows)).toEqual([tr('abandon', null, STEER), tr('uncertain', 'q-sub', SUBMITTED)]);
    expect(t.queue.state.steers).toBeUndefined();
    expect((await store.loadQueue(ID)).steers).toBeUndefined();
  });

  it('drop: a submission the engine cancels, discards or refuses before it started, with its reason, before the change without it', async () => {
    for (const state of ['cancelled', 'discarded', 'refused'] as const) {
      const t = await harness();
      const { entry } = await t.queue.send('one');
      t.queue.onLifecycle(lifecycle(entry.messageUuid!, 'queued'));
      t.queue.onLifecycle(lifecycle(entry.messageUuid!, state));
      await flush();
      expect(transitions(t.rows)).toEqual([tr('release', entry.queueId, entry.messageUuid), tr('drop', entry.queueId, entry.messageUuid, state)]);
      expect(rowAt(t.timeline, 'drop', entry.queueId)).toBeLessThan(goneAt(t.timeline, entry.queueId));
    }
  });

  it('withdraw then hold: the claim is stated before it is published, the held entry before it is', async () => {
    const t = await harness();
    t.h.turn = true;
    const { messageUuid } = await t.queue.steer('then this', { priority: 'next' });
    const entry = await t.queue.hold(messageUuid);
    expect(transitions(t.rows)).toEqual([tr('withdraw', null, messageUuid), tr('hold', entry.queueId, messageUuid)]);
    expect(rowAt(t.timeline, 'withdraw', messageUuid)).toBeLessThan(changeAt(t.timeline, (q) => q.withdrawn?.includes(messageUuid) === true));
    expect(rowAt(t.timeline, 'hold', entry.queueId)).toBeLessThan(changeAt(t.timeline, (q) => q.entries.some((e) => e.queueId === entry.queueId)));
  });

  it('withdraw then giveback: a cancel that fails, or that the engine answers it had nothing to withdraw, gives the claim back as a row', async () => {
    const failed = await harness();
    failed.h.turn = true;
    const { messageUuid: lost } = await failed.queue.steer('then this', { priority: 'next' });
    failed.h.cancelFor = () => Promise.reject(new Error('cancel_async_message unanswered'));
    await expect(failed.queue.hold(lost)).rejects.toThrow('unanswered');
    expect(transitions(failed.rows)).toEqual([tr('withdraw', null, lost), tr('giveback', null, lost)]);
    expect(rowAt(failed.timeline, 'giveback', lost)).toBeLessThan(changeAt(failed.timeline, (q) => q.withdrawn === undefined, rowAt(failed.timeline, 'withdraw', lost)));

    const refused = await harness();
    refused.h.turn = true;
    const { messageUuid: taken } = await refused.queue.steer('then this', { priority: 'next' });
    refused.h.cancelled = false;
    await expect(refused.queue.cancelSteer(taken)).resolves.toEqual({ outcome: 'already_started' });
    expect(transitions(refused.rows)).toEqual([tr('withdraw', null, taken), tr('giveback', null, taken)]);
  });

  it('promote: journaled before its write, so a start the write drains follows it; a failed write reverts it', async () => {
    const t = await harness();
    t.h.turn = true;
    const { entry } = await t.queue.send('queued');
    let atWrite: Transition[] = [];
    t.h.onWrite = (frame) => {
      atWrite = transitions(t.rows);
      t.queue.onLifecycle(lifecycle(frame.uuid as MessageUuid, 'started')); // the writer's settle drains the engine's start
    };
    const { messageUuid } = await t.queue.promote(entry.queueId, { priority: 'next' });
    expect(atWrite).toEqual([tr('promote', entry.queueId, messageUuid)]);
    expect(transitions(t.rows)).toEqual([tr('promote', entry.queueId, messageUuid)]);
    expect(rowAt(t.timeline, 'promote', entry.queueId)).toBeLessThan(goneAt(t.timeline, entry.queueId));

    const failing = await harness({ failWrite: () => true });
    failing.h.turn = true;
    const { entry: queued } = await failing.queue.send('queued');
    await expect(failing.queue.promote(queued.queueId)).rejects.toThrow('EPIPE');
    const uuid = transitions(failing.rows)[0]!.messageUuid;
    expect(transitions(failing.rows)).toEqual([tr('promote', queued.queueId, uuid), tr('revert', queued.queueId, uuid)]);
  });

  it('remove: one row once the removal is saved and before it is published; a removal that cannot be saved states nothing', async () => {
    const t = await harness();
    t.h.turn = true;
    const { entry } = await t.queue.send('changed my mind');
    await t.queue.remove(entry.queueId);
    expect(transitions(t.rows)).toEqual([tr('remove', entry.queueId, null)]);
    expect(rowAt(t.timeline, 'remove', entry.queueId)).toBeLessThan(goneAt(t.timeline, entry.queueId));

    const failing = await harness();
    failing.h.turn = true;
    const { entry: kept } = await failing.queue.send('kept');
    failingSaves(failing.store);
    await expect(failing.queue.remove(kept.queueId)).rejects.toThrow('EIO');
    expect(transitions(failing.rows)).toEqual([]);
    expect(failing.queue.state.entries.map((e) => e.queueId)).toEqual([kept.queueId]);
  });
});

// P2-C (the P2-C document, Design §6 "Cancel" and Interfaces `session.steer.cancel`): a pending steer withdrawn and
// dropped, never re-queued, so a cancelled answer is never sent by its own cancellation.
describe('cancelSteer (P2-C)', () => {
  const steps = (rows: Record<string, unknown>[]) => transitions(rows).map((t) => [t.action, t.messageUuid]);

  it('withdraws the pending steer and drops it: no held entry, no release, its uuid kept withdrawn, the cancel row before the published change', async () => {
    const t = await harness();
    t.h.turn = true;
    const { messageUuid } = await t.queue.steer('the answer', { priority: 'next' });
    await expect(t.queue.cancelSteer(messageUuid)).resolves.toEqual({ outcome: 'cancelled' });
    expect(t.cancels).toEqual([messageUuid]);
    expect(steps(t.rows)).toEqual([['withdraw', messageUuid], ['cancel', messageUuid]]);
    expect(t.queue.state).toMatchObject({ entries: [], withdrawn: [messageUuid] });
    expect(t.queue.state.steers).toBeUndefined();
    expect(await t.store.loadQueue(ID)).toMatchObject({ entries: [], withdrawn: [messageUuid] });
    const cancelRow = rowAt(t.timeline, 'cancel', messageUuid);
    expect(t.timeline.slice(cancelRow + 1).some((e) => 'change' in e)).toBe(true); // published after its row
    expect(t.writes).toHaveLength(1); // the steer's own write only
  });

  it('with the turn ending mid-cancel: drops the steer, releases nothing and writes nothing (where hold would send it)', async () => {
    const t = await harness();
    t.h.turn = true;
    const { messageUuid } = await t.queue.steer('the answer', { priority: 'next' });
    let answer!: () => void;
    t.h.cancelAnswer = new Promise<void>((resolve) => (answer = resolve));
    const cancelling = t.queue.cancelSteer(messageUuid);
    await flush();
    t.queue.onLifecycle(lifecycle(messageUuid, 'cancelled')); // the engine's withdrawal, then the running turn ends
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ origin: 'human' }));
    answer();
    await expect(cancelling).resolves.toEqual({ outcome: 'cancelled' });
    await flush();
    expect(t.writes).toHaveLength(1);
    expect(t.queue.state.entries).toEqual([]);
    expect(queueRows(t.rows)).toEqual([]);
  });

  it("an entry the unstarted steer held back at the turn's end goes once the steer is cancelled, under the usual gates", async () => {
    const t = await harness();
    t.h.turn = true;
    const { entry: waiting } = await t.queue.send('queued behind');
    const { messageUuid } = await t.queue.steer('the answer', { priority: 'next' });
    let answer!: () => void;
    t.h.cancelAnswer = new Promise<void>((resolve) => (answer = resolve));
    const cancelling = t.queue.cancelSteer(messageUuid);
    await flush();
    await t.queue.onTurnEnded(turnEnded({ origin: 'human' })); // the turn ends while the steer is still unstarted (busy): nothing goes
    expect(t.writes).toHaveLength(1);
    t.queue.onLifecycle(lifecycle(messageUuid, 'cancelled'));
    t.h.turn = false; // withdrawn: nothing waits to start any more
    answer();
    await cancelling;
    expect(t.writes.map((w) => w.message.content)).toEqual(['the answer', 'queued behind']);
    expect(t.queue.state.entries).toMatchObject([{ queueId: waiting.queueId, state: 'submitting' }]);
    expect(queueRows(t.rows)).toEqual(['release:hold']);
  });

  it('answers already_started for a uuid that is not a pending steer, without asking the engine, and after the engine took it', async () => {
    const t = await harness();
    t.h.turn = true;
    await expect(t.queue.cancelSteer('77777777-7777-4777-8777-777777777777' as MessageUuid)).resolves.toEqual({ outcome: 'already_started' });
    const { messageUuid } = await t.queue.steer('the answer', { priority: 'next' });
    t.queue.onLifecycle(lifecycle(messageUuid, 'started'));
    await expect(t.queue.cancelSteer(messageUuid)).resolves.toEqual({ outcome: 'already_started' });
    expect(t.cancels).toEqual([]);
    expect(t.rows.filter((r) => r.event === 'queue')).toEqual([]);
  });

  it('is refused while a hold withdraws the steer', async () => {
    const t = await harness();
    t.h.turn = true;
    const { messageUuid } = await t.queue.steer('the answer', { priority: 'next' });
    let answer!: () => void;
    t.h.cancelAnswer = new Promise<void>((resolve) => (answer = resolve));
    const holding = t.queue.hold(messageUuid);
    await flush();
    await expect(t.queue.cancelSteer(messageUuid)).rejects.toThrow('already being withdrawn');
    answer();
    await holding;
    expect(t.cancels).toEqual([messageUuid]);
  });

  it('a failed cancel gives the claim back and rejects; the steer stays pending and can be cancelled again', async () => {
    const t = await harness();
    t.h.turn = true;
    const { messageUuid } = await t.queue.steer('the answer', { priority: 'next' });
    t.h.cancelFor = () => Promise.reject(new Error('cancel_async_message unanswered'));
    await expect(t.queue.cancelSteer(messageUuid)).rejects.toThrow('unanswered');
    expect(t.queue.state.steers?.map((s) => s.messageUuid)).toEqual([messageUuid]);
    expect(t.queue.state.withdrawn).toBeUndefined();
    t.h.cancelFor = null;
    await expect(t.queue.cancelSteer(messageUuid)).resolves.toEqual({ outcome: 'cancelled' });
    expect(steps(t.rows)).toEqual([['withdraw', messageUuid], ['giveback', messageUuid], ['withdraw', messageUuid], ['cancel', messageUuid]]);
  });

  it('an exit while the cancel is unanswered abandons the steer; the cancel failing after it gives nothing back', async () => {
    const t = await harness();
    t.h.turn = true;
    const { messageUuid } = await t.queue.steer('the answer', { priority: 'next' });
    let fail!: (error: Error) => void;
    t.h.cancelFor = () => new Promise<boolean>((_, reject) => (fail = reject));
    const cancelling = t.queue.cancelSteer(messageUuid);
    await flush();
    t.queue.onLifecycle(lifecycle(messageUuid, 'cancelled')); // the engine withdrew it; the process dies before answering
    await t.queue.onProcessExited('crash');
    fail(new Error('no engine process'));
    await expect(cancelling).rejects.toThrow('no engine process');
    expect(steps(t.rows)).toEqual([['withdraw', messageUuid], ['abandon', messageUuid]]);
  });
});
// P2-C end
