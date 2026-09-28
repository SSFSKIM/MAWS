import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, EventId, MessageUuid, SessionId } from '@shared/graph/ids';
import type { QueueEntry, QueueState } from '@shared/engine/session-state-store';
import type { UserInputFrame } from '@shared/wire/frames';
import { MessageQueue } from './queue';
import { MemorySessionStateStore } from './store/memory-session-state-store';

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
// `turn` stands in for the normaliser's open turn (a write opens one, as the out row does).
async function harness(opts: { store?: MemorySessionStateStore; failWrite?: (frame: UserInputFrame) => boolean; holdWrites?: boolean; recovered?: boolean } = {}) {
  const store = opts.store ?? new MemorySessionStateStore();
  const writes: UserInputFrame[] = [];
  const rows: Record<string, unknown>[] = [];
  const changes: QueueState[] = [];
  const held: (() => void)[] = [];
  const h = { turn: false, ready: true, store, writes, rows, changes, held, storeAtWrite: [] as QueueState[] };
  const queue = new MessageQueue({
    appSessionId: ID,
    store,
    write: async (frame) => {
      h.storeAtWrite.push(await store.loadQueue(ID)); // what a crash at this instant would leave behind
      if (opts.holdWrites) await new Promise<void>((r) => held.push(r));
      if (opts.failWrite?.(frame)) throw new Error('EPIPE');
      writes.push(frame);
      if (frame.shouldQuery !== false) h.turn = true;
    },
    meta: (frame) => rows.push(frame),
    turnOpen: () => h.turn,
    canWrite: () => h.ready,
    onChange: (q) => changes.push(q),
    log: () => {},
  });
  if (opts.recovered !== false) await queue.recover(); // what the session does before `ready`
  return { ...h, h, queue };
}

const notices = (rows: Record<string, unknown>[]) => rows.filter((r) => r.event === 'notice').map((r) => r.key);
const queueRows = (rows: Record<string, unknown>[]) => rows.filter((r) => r.event === 'queue').map((r) => `${String(r.action)}:${String(r.trigger ?? r.reason)}`);

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

  it('a result naming a submission the engine never acknowledged still retires it', async () => {
    const t = await harness();
    const { entry } = await t.queue.send('one');
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ userMessageUuids: [entry.messageUuid!] }));
    expect(t.queue.state.entries).toEqual([]);
    expect(t.queue.busy).toBe(false);
  });

  it('a task-notification turn and an echo receipt release nothing', async () => {
    const t = await harness();
    t.h.turn = true;
    await t.queue.send('waiting');
    t.h.turn = false;
    await t.queue.onTurnEnded(turnEnded({ origin: 'task-notification', userMessageUuids: [] }));
    await t.queue.onTurnEnded(turnEnded({ origin: 'human', isEchoReceipt: true, numTurns: 0, terminalReason: null }));
    await t.queue.onTurnEnded(turnEnded({ origin: 'human', parentToolUseId: 'toolu_x' as TurnEnded['parentToolUseId'] }));
    expect(t.writes).toEqual([]);
    expect(t.queue.state.entries).toMatchObject([{ state: 'queued' }]);
    expect(queueRows(t.rows)).toEqual([]);
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
    queueId: 'q-x', appSessionId: ID, content: 'lost?', createdAt: '2026-09-28T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, ...over,
  });
  const SUBMITTED = '55555555-5555-4555-8555-555555555555' as MessageUuid;

  it('a store holding a submitting entry recovers it as the uncertain head of a paused queue; setPaused(false) writes it exactly once and clears uncertain', async () => {
    const store = new MemorySessionStateStore();
    await store.saveQueue(ID, { entries: [entry({ queueId: 'q-later', content: 'later' }), entry({ queueId: 'q-sub', state: 'submitting', messageUuid: SUBMITTED, submittedAt: '2026-09-28T10:00:01.000Z' })], paused: false });
    const t = await harness({ store, recovered: false });
    await t.queue.recover();
    expect(t.queue.state).toEqual({ paused: true, entries: [entry({ queueId: 'q-sub', content: 'lost?', uncertain: true }), entry({ queueId: 'q-later', content: 'later' })] });
    expect(notices(t.rows)).toEqual(['queue:uncertain:q-sub']);
    expect(queueRows(t.rows)).toEqual(['pause:uncertain']);
    expect(await store.loadQueue(ID)).toEqual(t.queue.state);

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
    expect(await store.loadQueue(ID)).toEqual(stored);
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
    expect(t.queue.state).toEqual({ entries: [], paused: false });
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
    expect(t.queue.state).toEqual({ entries: [], paused: false });
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
    expect(t.queue.state).toEqual({ paused: true, entries: [{ ...submitting, state: 'queued', messageUuid: null, submittedAt: null, uncertain: true }] });
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
    expect(await t.store.loadQueue(ID)).toEqual(t.queue.state);
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
