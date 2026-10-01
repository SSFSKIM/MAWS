// The app queue, the stores and the exit paths replayed through whole EngineSessions (C3 M4): the probe's fixtures
// drive the engine side, the session API drives ours, and the replay fails on any write the probe never recorded, so a
// queue release that should not happen shows up as a `replay_mismatch` row, not as a silently advanced graph.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid, RequestId } from '@shared/graph/ids';
import type { QueueEntry, QueueState } from '@shared/engine/session-state-store';
import type { JournalRow } from '@shared/wire/journal';
import { loadJournal } from '../../../test/support/fixtures';
import { listPermissionRules } from '../controls';
import { FileSessionStateStore } from '../store/file-session-state-store';
import { MemorySessionStateStore } from '../store/memory-session-state-store';
import { handshakeResponder, replayedSession, scriptedSession } from './session-harness';

const ofKind = <K extends SessionEvent['kind']>(events: SessionEvent[], kind: K) => events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);
const metaRows = (rows: JournalRow[], event: string) => rows.filter((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === event).map((r) => r.frame as Record<string, unknown>);
const userOuts = (rows: JournalRow[]) => rows.filter((r) => r.direction === 'out' && (r.frame as { type: string }).type === 'user').map((r) => r.frame as { uuid: MessageUuid; message: { content: unknown }; priority?: string });
const flush = () => new Promise((r) => setImmediate(r));
const contentOf = (fixture: JournalRow[], seq: number) => (fixture.find((r) => r.seq === seq)!.frame as { message: { content: string } }).message.content;

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-queue-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe('queue release never follows an engine-initiated turn', () => {
  // pass2/workflow: the human turn ends at seq 90, the engine-initiated turn opens at seq 97 and ends at seq 108, then
  // the exit (seq 110). The probe queued nothing, so a test that expects a release extends the recording with the one
  // `out` user row the release writes (matched by type), inserted where the release happens.
  const releaseRow = { seq: 9_001, direction: 'out' as const, at: '2026-09-28T10:00:00.000Z', frame: { type: 'user', uuid: 'recorded-release', message: { role: 'user', content: 'queued' }, parent_tool_use_id: null, origin: { kind: 'human' } } };
  const insertAfter = (seq: number) => (rows: JournalRow[]) => {
    const at = rows.findIndex((r) => r.seq === seq) + 1;
    return [...rows.slice(0, at), releaseRow, ...rows.slice(at)];
  };
  const releases = (rows: JournalRow[]) => metaRows(rows, 'queue').filter((r) => r.action === 'release').map((r) => r.trigger);
  const queueDuring = (origin: 'human' | 'engine', content: string) => ({ session }: { session: import('../session').EngineSession }) => {
    let queued = false;
    session.on('events', (batch) => {
      if (!queued && batch.some((e) => e.kind === 'turn.started' && e.origin === origin)) {
        queued = true;
        void session.send(content);
      }
    });
  };
  const driveWorkflow = (row: JournalRow, { session, transport, ready, fixture }: { session: import('../session').EngineSession; transport: { kill(s: 'SIGTERM'): void }; ready: () => Promise<void>; fixture: JournalRow[] }) => {
    if (row.seq === 5) void ready().then(() => session.send(contentOf(fixture, 5)));
    else if (row.seq !== releaseRow.seq) transport.kill('SIGTERM'); // the release row is the queue's own write
  };

  it('pass2/workflow: a message typed during the engine-initiated turn is not released into it; its end at seq 108 leaves the session idle, so the head goes then', async () => {
    const run = await replayedSession('pass2', 'workflow', driveWorkflow, { edit: insertAfter(108), beforeStart: queueDuring('engine', 'typed while the workflow reported back') });
    expect(metaRows(run.journal.rows, 'replay_mismatch')).toEqual([]);
    const engineEnd = ofKind(run.events, 'turn.ended').find((e) => e.origin === 'task-notification')!;
    const outs = userOuts(run.journal.rows);
    expect(outs.map((f) => f.message.content)).toEqual([contentOf(run.fixture, 5), 'typed while the workflow reported back']);
    const released = run.journal.rows.find((r) => r.direction === 'out' && (r.frame as { message?: { content: unknown } }).message?.content === 'typed while the workflow reported back')!;
    expect(released.seq).toBeGreaterThan(engineEnd.seq!); // after the engine turn's result, never into it
    expect(released.frame).not.toHaveProperty('priority');
    expect(releases(run.journal.rows)).toEqual(['send', 'turn_ended']);
    // no engine_turn hold; the only pause is the exit's: the recording ends before the engine acknowledges the release, so it comes back uncertain
    expect(metaRows(run.journal.rows, 'queue').filter((r) => r.action === 'pause').map((r) => r.reason)).toEqual(['uncertain']);
    expect(ofKind(run.events, 'notice.posted').map((e) => e.key)).toEqual([expect.stringMatching(/^queue:uncertain:/)]);
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('pass2/workflow: a message typed during the human turn is released at the human turn\'s end (seq 90) and nothing more at seq 108: one release across the two turns', async () => {
    const run = await replayedSession('pass2', 'workflow', driveWorkflow, { edit: insertAfter(90), beforeStart: queueDuring('human', 'typed during the human turn') });
    expect(metaRows(run.journal.rows, 'replay_mismatch')).toEqual([]);
    expect(userOuts(run.journal.rows).map((f) => f.message.content)).toEqual([contentOf(run.fixture, 5), 'typed during the human turn']);
    expect(releases(run.journal.rows)).toEqual(['send', 'turn_ended']); // acceptance 3.10: exactly one release across the two turns
    const releaseMeta = run.journal.rows.find((r) => (r.frame as { trigger?: string }).trigger === 'turn_ended')!;
    const humanEnd = ofKind(run.events, 'turn.ended')[0]!;
    expect(releaseMeta.seq).toBeGreaterThan(humanEnd.seq!);
    // no engine_turn hold; the only pause is the exit's: the recording ends before the engine acknowledges the release, so it comes back uncertain
    expect(metaRows(run.journal.rows, 'queue').filter((r) => r.action === 'pause').map((r) => r.reason)).toEqual(['uncertain']);
    expect(ofKind(run.events, 'notice.posted').map((e) => e.key)).toEqual([expect.stringMatching(/^queue:uncertain:/)]);
  });

  it('pass2/workflow with an empty queue: the engine turn\'s end writes nothing, pauses nothing and posts no notice', async () => {
    const run = await replayedSession('pass2', 'workflow', (row, { session, transport, ready, fixture }) => {
      if (row.seq === 5) void ready().then(() => session.send(contentOf(fixture, 5)));
      else transport.kill('SIGTERM');
    });
    expect(metaRows(run.journal.rows, 'replay_mismatch')).toEqual([]);
    expect(ofKind(run.events, 'turn.ended').map((e) => e.origin)).toEqual(['human', 'task-notification']);
    expect(userOuts(run.journal.rows)).toHaveLength(1);
    expect(releases(run.journal.rows)).toEqual(['send']);
    expect(run.session.queue.state).toEqual({ entries: [], paused: false, pauseReason: null }); // C7: pauseReason
    expect(metaRows(run.journal.rows, 'queue').filter((r) => r.action === 'pause')).toEqual([]);
    expect(ofKind(run.events, 'notice.posted')).toEqual([]);
  });

  it('pass2/dialogs: the submission is released at the command_lifecycle naming it (seq 6 against seq 5) and leaves the list at the turn.ended naming it (seq 55)', async () => {
    const seen: QueueState[] = [];
    let uuid: MessageUuid | null = null;
    const run = await replayedSession('pass2', 'dialogs', (row, { session, transport, ready, fixture }) => {
      const frame = row.frame as { type: string };
      if (frame.type === 'user') void ready().then(() => session.send(contentOf(fixture, 5))).then((r) => (uuid = r.messageUuid));
      else if (frame.type === 'control_response') return; // answered below
      else transport.kill('SIGTERM');
    }, {
      beforeStart: ({ session }) => {
        session.on('queue', (q) => seen.push(q));
        session.on('brokerItems', (items) => {
          const pending = items.find((i) => i.state === 'pending');
          if (pending) void session.answer(pending.request.requestId as RequestId, { kind: 'elicitation', action: 'accept', content: { color: 'teal' } });
        });
      },
    });
    expect(metaRows(run.journal.rows, 'replay_mismatch')).toEqual([]);
    const states = seen.map((q) => q.entries.map((e) => e.state).join(','));
    expect(states.filter((s, i) => s !== states[i - 1])).toEqual(['', 'submitting', 'released', '']);
    const releasedAt = run.journal.rows.find((r) => (r.frame as { type?: string; command_uuid?: string }).type === 'command_lifecycle' && (r.frame as { command_uuid: string }).command_uuid === uuid);
    expect(releasedAt).toMatchObject({ direction: 'in', frame: { state: 'queued' } });
    expect(ofKind(run.events, 'turn.ended').filter((e) => !e.isEchoReceipt).map((e) => e.userMessageUuids)).toEqual([[uuid]]);
  });

  it('interrupt pauses the queue before writing interrupt { reason: user-cancel, cancel_queued }; the turn.ended it causes releases nothing until setPaused(false)', async () => {
    const interrupted = loadJournal('pass1', 'queue-and-interrupt').find((r) => r.seq === 192)!.frame as { response: { response: unknown } };
    const s = scriptedSession({ responder: handshakeResponder({ interrupt: () => ({ response: interrupted.response.response }) }) });
    await s.session.start();
    const first = await s.session.send('Count to 30 slowly.');
    expect((await s.session.send('After counting, reply exactly QUEUED.')).disposition).toBe('queued');
    const result = await s.session.interrupt({ cancelEngineQueued: true });
    expect(result).toEqual({ stillQueued: [], cancelled: ['99662785-5122-45a7-a68f-d734959a0c52'] });
    expect(s.transport.requestsOf('interrupt')[0]!.request).toEqual({ subtype: 'interrupt', reason: 'user-cancel', cancel_queued: true });
    const pauseRow = s.journal.rows.findIndex((r) => (r.frame as { event?: string; action?: string }).action === 'pause');
    const interruptRow = s.journal.rows.findIndex((r) => (r.frame as { request?: { subtype: string } }).request?.subtype === 'interrupt');
    expect(pauseRow).toBeLessThan(interruptRow);
    expect(s.session.status().queue).toEqual({ length: 1, paused: true });

    s.transport.push({ type: 'result', subtype: 'error_during_execution', session_id: 's', is_error: false, duration_ms: 1, num_turns: 6, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'aborted_streaming', user_message_uuids: [first.messageUuid], origin: { kind: 'human' } });
    await flush();
    expect(userOuts(s.journal.rows)).toHaveLength(1);
    await s.session.queue.setPaused(false);
    expect(userOuts(s.journal.rows).map((f) => f.message.content)).toEqual(['Count to 30 slowly.', 'After counting, reply exactly QUEUED.']);
  });

  // W1: the plain stop (`holdEngineQueued`): the engine would start a waiting `next` steer as its own turn once the
  // running one is interrupted (pass3/steer-next-interrupted), so the stop first withdraws each (cancel_async_message,
  // pass3/steer-next-cancelled) into the paused queue, in order, and only then writes the interrupt.
  it('interrupt with holdEngineQueued pauses, cancels each waiting next steer in order, then interrupts; the steers wait as held entries', async () => {
    const interrupted = loadJournal('pass1', 'queue-and-interrupt').find((r) => r.seq === 192)!.frame as { response: { response: unknown } };
    const s = scriptedSession({
      responder: handshakeResponder({ interrupt: () => ({ response: interrupted.response.response }), cancel_async_message: () => ({ response: { cancelled: true } }) }),
    });
    await s.session.start();
    await s.session.send('Count to 30 slowly.');
    const a = (await s.session.steer('look at a too', { priority: 'next' })).messageUuid;
    const b = (await s.session.steer('and b', { priority: 'next' })).messageUuid;
    expect(s.session.queue.state.steers?.map((steer) => steer.messageUuid)).toEqual([a, b]);
    await s.session.interrupt({ cancelEngineQueued: false, holdEngineQueued: true });
    expect(s.transport.requestsOf('cancel_async_message').map((r) => r.request)).toEqual([
      { subtype: 'cancel_async_message', message_uuid: a },
      { subtype: 'cancel_async_message', message_uuid: b },
    ]);
    const order = (subtype: string) => s.journal.rows.findIndex((r) => (r.frame as { request?: { subtype: string } }).request?.subtype === subtype);
    const pauseRow = s.journal.rows.findIndex((r) => (r.frame as { action?: string }).action === 'pause');
    expect(pauseRow).toBeLessThan(order('cancel_async_message'));
    expect(s.journal.rows.findLastIndex((r) => (r.frame as { request?: { subtype: string } }).request?.subtype === 'cancel_async_message')).toBeLessThan(order('interrupt'));
    expect(s.session.queue.state.entries.filter((e) => e.state === 'queued').map((e) => e.content)).toEqual(['look at a too', 'and b']);
    expect(s.session.queue.state).toMatchObject({ paused: true, pauseReason: 'interrupt', withdrawn: [a, b] });
    expect(s.session.queue.state.steers).toBeUndefined();
  });

  it('pass1/queue-and-interrupt cut to the queued prompt (seq 146, 150) and the interrupt (190-192), plus one recorded send: the submission the engine cancels before it started (seq 191) retires there with its own notice, so the next send goes at once', async () => {
    const againRow = { seq: 9_002, direction: 'out' as const, at: '2026-09-28T10:00:00.000Z', frame: { type: 'user', uuid: 'recorded-again', message: { role: 'user', content: 'again' }, parent_tool_use_id: null, origin: { kind: 'human' } } };
    const cut = (rows: JournalRow[]) => [...rows.filter((r) => r.seq <= 3 || [146, 150, 190, 191, 192].includes(r.seq)), againRow];
    let afterInterrupt: { cancelled: number; busy: boolean; entries: QueueEntry[]; disposition: string | null } | null = null;
    const run = await replayedSession('pass1', 'queue-and-interrupt', (row, { session, transport, ready, fixture }) => {
      if (row.seq === 146) void ready().then(() => session.send(contentOf(fixture, 146)));
      else if (row.seq === 190) {
        void session.interrupt({ cancelEngineQueued: true }).then(async (result) => {
          afterInterrupt = { cancelled: result.cancelled.length, busy: session.queue.busy, entries: session.queue.state.entries, disposition: null };
          afterInterrupt.disposition = (await session.send('again')).disposition;
          transport.kill('SIGTERM');
        });
      }
    }, { edit: cut });
    expect(metaRows(run.journal.rows, 'replay_mismatch')).toEqual([]);
    expect(afterInterrupt).toEqual({ cancelled: 1, busy: false, entries: [], disposition: 'sent' });
    const [submitted] = userOuts(run.journal.rows);
    const cancelled = run.journal.rows.findIndex((r) => (r.frame as { type?: string; state?: string; command_uuid?: string }).type === 'command_lifecycle' && (r.frame as { state: string }).state === 'cancelled');
    expect((run.journal.rows[cancelled]!.frame as { command_uuid: string }).command_uuid).toBe(submitted!.uuid);
    const notice = run.journal.rows[cancelled + 1]!.frame as { event: string; key: string };
    expect(notice).toMatchObject({ event: 'notice', key: expect.stringMatching(/^queue:dropped:/) }); // at the lifecycle, not at the exit
    expect(ofKind(run.events, 'notice.posted').filter((e) => e.key?.startsWith('queue:dropped:'))).toHaveLength(1);
    expect(ofKind(run.events, 'notice.posted').filter((e) => e.key?.startsWith('queue:interrupted:'))).toEqual([]); // the live session did not end
    expect(userOuts(run.journal.rows).map((f) => f.message.content)).toEqual([contentOf(run.fixture, 146), 'again']);
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('steer writes priority now at once with an entry still queued, and never enters the app queue', async () => {
    const s = scriptedSession();
    await s.session.start();
    await s.session.send('first');
    await s.session.send('queued');
    const { messageUuid } = await s.session.steer('Stop counting and reply STEERED');
    expect(userOuts(s.journal.rows).at(-1)).toEqual({ type: 'user', uuid: messageUuid, message: { role: 'user', content: 'Stop counting and reply STEERED' }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: 'now' });
    expect(s.session.queue.state.entries.map((e) => [e.content, e.state])).toEqual([['first', 'submitting'], ['queued', 'queued']]);
    // not folded into the open turn: the steer waits unstarted and holds the queue until its own turn ends (coordinator ruling after M6 live 3.7)
    expect(s.session.status().turn?.userMessageUuids ?? []).not.toContain(messageUuid);
    expect(s.session.queue.busy).toBe(true);
  });
});

describe('a submission the engine drops before it started releases the next queued message', () => {
  it('the drop retires the entry with its own notice, then the head goes and opens its own turn', async () => {
    const s = scriptedSession();
    const statuses: { turn: unknown; queue: unknown }[] = [];
    s.session.on('status', (status) => statuses.push({ turn: status.turn, queue: status.queue }));
    await s.session.start();
    const lifecycle = (uuid: string, state: string) => s.transport.push({ type: 'command_lifecycle', command_uuid: uuid, state, uuid: `lc-${uuid}-${state}`, session_id: 's' });
    const first = await s.session.send('first');
    const second = await s.session.send('second');
    expect([first.disposition, second.disposition]).toEqual(['sent', 'queued']);
    lifecycle(first.messageUuid!, 'queued');
    lifecycle(first.messageUuid!, 'cancelled'); // not an interrupt of ours: the queue is not paused
    await flush();
    await flush();
    const outs = userOuts(s.journal.rows);
    expect(outs.map((f) => f.message.content)).toEqual(['first', 'second']);
    const cancelledRow = s.journal.rows.findIndex((r) => (r.frame as { state?: string }).state === 'cancelled');
    const releaseRow = s.journal.rows.findIndex((r) => (r.frame as { event?: string; trigger?: string }).event === 'queue' && (r.frame as { trigger?: string }).trigger === 'dropped');
    expect(releaseRow).toBeGreaterThan(cancelledRow);
    const tail = s.events.slice(s.events.findIndex((e) => e.kind === 'command.lifecycle' && e.state === 'cancelled'));
    expect(tail.map((e) => (e.kind === 'notice.posted' ? `notice:${e.key!.split(':').slice(0, 2).join(':')}` : e.kind))).toEqual(['command.lifecycle', 'notice:queue:dropped', 'user.message']); // the notice, then the released head
    expect(ofKind(s.events, 'turn.started')).toEqual([]);
    expect(s.session.status().queue).toEqual({ length: 0, paused: false }); // nothing left waiting: the head is submitting
    expect(statuses.at(-1)).toEqual({ turn: null, queue: { length: 0, paused: false } });

    lifecycle(outs[1]!.uuid, 'started');
    await flush();
    expect(ofKind(s.events, 'turn.started').map((e) => e.userMessageUuid)).toEqual([outs[1]!.uuid]);
  });

  it('a drop caused by interrupt() releases nothing: the queue reads paused with the waiting entry still queued', async () => {
    const s = scriptedSession({ responder: handshakeResponder({ interrupt: () => ({ response: { still_queued: [], cancelled: [] } }) }) });
    await s.session.start();
    const lifecycle = (uuid: string, state: string) => s.transport.push({ type: 'command_lifecycle', command_uuid: uuid, state, uuid: `lc-${uuid}-${state}`, session_id: 's' });
    const first = await s.session.send('first');
    expect((await s.session.send('waiting')).disposition).toBe('queued');
    lifecycle(first.messageUuid!, 'queued');
    await s.session.interrupt({ cancelEngineQueued: true });
    lifecycle(first.messageUuid!, 'cancelled'); // the engine drops the unstarted submission the interrupt cancelled
    await flush();
    await flush();
    expect(userOuts(s.journal.rows).map((f) => f.message.content)).toEqual(['first']);
    expect(metaRows(s.journal.rows, 'queue').map((r) => `${String(r.action)}:${String(r.trigger ?? r.reason)}`)).toEqual(['release:send', 'pause:interrupt']);
    expect(s.session.status().queue).toEqual({ length: 1, paused: true });
    expect(s.session.queue.state.entries.map((e) => [e.content, e.state])).toEqual([['waiting', 'queued']]);
    expect(ofKind(s.events, 'notice.posted').filter((e) => e.key?.startsWith('queue:dropped:'))).toHaveLength(1);
  });
});

describe('steer priority', () => {
  it("writes the priority it is given ('now' by default, 'next' on request); promote defaults to 'now'", async () => {
    const s = scriptedSession();
    await s.session.start();
    await s.session.send('first');
    await s.session.send('to promote');
    const now = await s.session.steer('default');
    const next = await s.session.steer('Reply NEXT_OK', { priority: 'next' });
    await s.session.queue.promote(s.session.queue.state.entries.find((e) => e.content === 'to promote')!.queueId);
    const outs = userOuts(s.journal.rows);
    expect(outs.slice(1).map((f) => [f.message.content, f.priority])).toEqual([['default', 'now'], ['Reply NEXT_OK', 'next'], ['to promote', 'now']]);
    expect([now.messageUuid, next.messageUuid]).toEqual([outs[1]!.uuid, outs[2]!.uuid]);
  });
});

describe('a now steer holds the queue until its own turn ends (coordinator ruling after M6 live 3.7)', () => {
  it("the preempted turn's result releases nothing; the steer's own result releases the head, whose reply is its own turn", async () => {
    const s = scriptedSession();
    await s.session.start();
    const lifecycle = (uuid: string, state: string) => s.transport.push({ type: 'command_lifecycle', command_uuid: uuid, state, uuid: `lc-${uuid}-${state}`, session_id: 's' });
    const result = (uuids: string[], extra: Record<string, unknown> = {}) =>
      s.transport.push({ type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed', origin: { kind: 'human' }, user_message_uuids: uuids, ...extra });
    const first = await s.session.send('Count to 8 slowly.');
    lifecycle(first.messageUuid!, 'queued');
    lifecycle(first.messageUuid!, 'started');
    await flush();
    const queued = await s.session.send('Reply with exactly AFTER');
    expect(queued.disposition).toBe('queued');
    const { messageUuid: steer } = await s.session.steer('Stop counting and reply STEERED');
    // the live shape (pass3/steer-now seq 48 → 50 → 51): the running turn ends preempted, its command is cancelled, the steer starts
    result([first.messageUuid!], { terminal_reason: 'aborted_streaming', result: '' });
    await flush();
    expect(userOuts(s.journal.rows).map((f) => f.message.content)).toEqual(['Count to 8 slowly.', 'Stop counting and reply STEERED']); // nothing released
    expect(s.session.queue.busy).toBe(true);
    lifecycle(first.messageUuid!, 'cancelled');
    lifecycle(steer, 'started');
    await flush();
    expect(s.session.status().turn?.userMessageUuids).toEqual([steer]);
    result([steer], { result: 'STEERED' });
    await flush();
    await flush();
    const outs = userOuts(s.journal.rows);
    expect(outs.map((f) => f.message.content)).toEqual(['Count to 8 slowly.', 'Stop counting and reply STEERED', 'Reply with exactly AFTER']);
    const steerEnd = s.journal.rows.find((r) => r.direction === 'in' && (r.frame as { type?: string; user_message_uuids?: string[] }).user_message_uuids?.[0] === steer)!;
    const release = s.journal.rows.find((r) => (r.frame as { event?: string; trigger?: string }).event === 'queue' && (r.frame as { trigger?: string }).trigger === 'turn_ended')!;
    expect(release.seq).toBeGreaterThan(steerEnd.seq);
    lifecycle(outs[2]!.uuid, 'started');
    await flush();
    expect(ofKind(s.events, 'turn.started').map((e) => e.userMessageUuid)).toEqual([first.messageUuid, steer, outs[2]!.uuid]);
  });
});

describe('queue submission survives a crash around delivery', () => {
  it('pass2/dialogs killed after the engine acknowledged the send: the entry retires interrupted at the exit, nothing is re-sent, and the resumed session sends at once', async () => {
    const store = new FileSessionStateStore(userData);
    const id = 'replay-dialogs' as AppSessionId;
    let replay: { kill(signal: 'SIGKILL' | 'SIGTERM'): void } | null = null;
    const run = await replayedSession('pass2', 'dialogs', (row, { session, transport, ready, fixture }) => {
      replay = transport;
      if ((row.frame as { type: string }).type === 'user') void ready().then(() => session.send(contentOf(fixture, 5)));
      else transport.kill('SIGTERM');
    }, {
      session: { store },
      beforeStart: ({ session }) => {
        session.on('events', (batch) => {
          if (batch.some((e) => e.kind === 'command.lifecycle' && e.state === 'queued')) replay?.kill('SIGKILL'); // the process dies right after seq 6, before any result
        });
      },
    });
    expect(run.session.status().exit).toMatchObject({ reason: 'crash', signal: 'SIGKILL' });
    expect(ofKind(run.events, 'turn.ended')).toEqual([]);
    const [sent] = userOuts(run.journal.rows);
    expect(userOuts(run.journal.rows)).toHaveLength(1);
    const notices = ofKind(run.events, 'notice.posted').map((e) => e.key);
    expect(notices).toEqual([expect.stringMatching(/^queue:interrupted:/)]);
    const noticeRow = run.journal.rows.findIndex((r) => (r.frame as { key?: string }).key?.startsWith('queue:interrupted:'));
    expect(noticeRow).toBeLessThan(run.journal.rows.findIndex((r) => (r.frame as { event?: string }).event === 'exit'));
    expect(run.session.queue.busy).toBe(false);
    await flush();
    expect(await store.loadQueue(id)).toEqual({ entries: [], paused: false, pauseReason: null, corrupt: null }); // C7: pauseReason
    expect(sent).toBeDefined();

    const resumed = scriptedSession({ spec: { appSessionId: id, resume: { sessionId: '44444444-4444-4444-8444-444444444444' as never, fork: false }, sessionId: null }, session: { store } });
    await resumed.session.start();
    expect((await resumed.session.send('Reply OK')).disposition).toBe('sent');
  });

  it('a stored submitting entry comes back at ready as the uncertain head of a paused queue with its notice; Resume writes it exactly once', async () => {
    const store = new MemorySessionStateStore();
    const entry: QueueEntry = { queueId: 'q-1', appSessionId: 'app-s' as AppSessionId, content: 'did it arrive?', createdAt: '2026-09-28T10:00:00.000Z', state: 'submitting', messageUuid: '55555555-5555-4555-8555-555555555555' as MessageUuid, submittedAt: '2026-09-28T10:00:01.000Z', uncertain: false, steer: false };
    await store.saveQueue('app-s' as AppSessionId, { entries: [entry], paused: false });
    const s = scriptedSession({ session: { store } });
    await s.session.start();
    expect(s.session.status()).toMatchObject({ process: 'ready', queue: { length: 1, paused: true } });
    expect(s.session.queue.state.entries).toMatchObject([{ queueId: 'q-1', state: 'queued', uncertain: true, messageUuid: null }]);
    expect(ofKind(s.events, 'notice.posted')).toMatchObject([{ level: 'warning', key: 'queue:uncertain:q-1' }]);
    await s.session.queue.setPaused(false);
    await s.session.queue.setPaused(false);
    expect(userOuts(s.journal.rows).map((f) => f.message.content)).toEqual(['did it arrive?']);
  });
});

describe('grant snapshot re-applies through apply_flag_settings', () => {
  it('pass2/grant-reapply-start then -resume through the file store: the session grant and a queued message survive stop and resume; the grant is re-applied as seq 7 before the first user frame', async () => {
    const store = new FileSessionStateStore(userData);
    const id = 'app-grants' as AppSessionId;
    const resumeFixture = loadJournal('pass2', 'grant-reapply-resume');
    const nextPrompt = contentOf(resumeFixture, 11);

    // the start: allow with scope session; a message queued (and held) during the turn; stop at the post-turn read
    const start = await replayedSession('pass2', 'grant-reapply-start', (row, { session, transport, ready, fixture }) => {
      const frame = row.frame as { type: string; request?: { subtype: string } };
      if (frame.type === 'user') void ready().then(() => session.send(contentOf(fixture, 5)));
      else if (frame.type === 'control_response') return;
      else if (frame.request?.subtype === 'list_permission_rules') void session.stop('stop');
      else transport.kill('SIGTERM');
    }, {
      spec: { appSessionId: id, permissionMode: 'default' },
      session: { store },
      beforeStart: ({ session }) => {
        session.on('brokerItems', (items) => {
          const pending = items.find((i) => i.state === 'pending');
          if (!pending) return;
          void session.queue.pause('user'); // held back, so the turn's end does not release it into the fixture
          void session.send(nextPrompt);
          void session.answer(pending.request.requestId as RequestId, { kind: 'permission', decision: 'allow', scope: 'session' });
        });
      },
    });
    expect(metaRows(start.journal.rows, 'replay_mismatch')).toEqual([]);
    expect(start.session.status()).toMatchObject({ process: 'exited', exit: { reason: 'stop' }, grants: ['Bash(touch granted.txt)'] });
    expect(ofKind(start.events, 'process.exited')).toMatchObject([{ reason: 'stop', code: 0 }]);
    await store.loadGrants(id); // the store runs one session's operations in order: every save issued before this one has landed
    const file = JSON.parse(await readFile(join(userData, 'engine-host', 'state', `${id}.json`), 'utf8')) as { grants: unknown; queue: QueueState; launchSpec: { appSessionId: string } };
    expect(file.grants).toEqual({ allow: ['Bash(touch granted.txt)'] });
    expect(file.queue).toMatchObject({ paused: true, entries: [{ content: nextPrompt, state: 'queued' }] });
    expect(file.launchSpec.appSessionId).toBe(id);

    // the resume: grants and queue from the store; the fixture's reads issued as it recorded them; Resume releases the entry
    let atReady: QueueState | null = null;
    const resumed = await replayedSession('pass2', 'grant-reapply-resume', (row, { session, transport, ready }) => {
      const frame = row.frame as { type: string; request?: { subtype: string } };
      if (frame.request?.subtype === 'apply_flag_settings') return; // the session's own re-application (seq 7)
      if (frame.request?.subtype === 'list_permission_rules') void listPermissionRules(session.control!, {});
      else if (frame.type === 'user') void ready().then(() => ((atReady = session.queue.state), session.queue.setPaused(false)));
      else transport.kill('SIGTERM');
    }, {
      spec: { appSessionId: id, permissionMode: 'default', resume: { sessionId: 'f9bc61f8-7e18-466f-a860-8bb0781e2216' as never, fork: false } },
      session: { store },
    });
    expect(metaRows(resumed.journal.rows, 'replay_mismatch')).toEqual([]);
    expect(atReady).toMatchObject({ paused: true, entries: [{ content: nextPrompt, state: 'queued' }] });
    const outs = resumed.journal.rows.filter((r) => r.direction === 'out').map((r) => r.frame as { type: string; request?: { subtype: string } });
    const apply = outs.findIndex((f) => f.request?.subtype === 'apply_flag_settings');
    expect(outs[apply]!.request).toEqual((resumeFixture.find((r) => r.seq === 7)!.frame as { request: unknown }).request);
    expect(apply).toBeLessThan(outs.findIndex((f) => f.type === 'user'));
    expect(ofKind(resumed.events, 'session.reconnect').map((e) => e.phase)).toEqual(['attempting', 'reconnected']);
    expect(ofKind(resumed.events, 'permission.requested')).toEqual([]);
    expect(resumed.session.status().grants).toEqual(['Bash(touch granted.txt)']);
    expect(userOuts(resumed.journal.rows).map((f) => f.message.content)).toEqual([nextPrompt]);
    await flush();
    expect((await store.loadQueue(id)).entries).toEqual([]); // named by the seq 43 result
    expect(resumed.rebuilt()).toEqual(resumed.events);
  });
});
