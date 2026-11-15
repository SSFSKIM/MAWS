// UX wave U1c, M3 (the U1c document, Design 4, 5 and 7, Interfaces §F): what keeps "Approve and retry" closed, what a
// press sends on each route, and the store that holds a grant out between the press and the record. The bridge answers
// on command; the clock is faked.
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consentMessage } from '@shared/engine/arrival';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { addressOf, bareOf } from '@shared/machine/address';
import { humanTurn, record, remoteRow, status, T0 } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { TERMINAL_KEEPS_NO_QUEUE } from '../composer/submit/submit-state';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import { applyRemoteSession, resetRemoteLaneBStore } from '../lane-b/remote-session';
import { ALL_OPEN, remoteSessionState } from '../lane-b/test-support/remote-session';
import { sendToSession } from '../session/controls/controls-for';
import { LANE_A_WORDS } from '../session/controls/lane-a';
import { applyLaneAState, holdPendingSend, resetLaneAStore, useLaneA } from '../stores/lane-a';
import { useMachines } from '../stores/machines';
import { attachQueue, resetQueueStore, useQueueStore, type SessionQueue } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import { blockedKey, type BlockedCall } from '../transcript/model/blocked';
import { expandedTurnRows } from '../transcript/model/derive';
import type { CellId } from '../transcript/model/rows';
import { builder } from '../transcript/model/test-events';
import type { TranscriptSource } from '../transcript/source/types';
import { approve, gateOf, GRANT_DURING_TURN, grantOptions, pressedTurnExpansions, resetGrantsOut, SETTLE_MS, TERMINAL_OFFERED, terminalRefusal, terminalStateOf, useGrantsOut, waitingGrants } from './grants';

const BUILD: BlockedCall = { kind: 'command', subject: 'make build' };
const CHECK: BlockedCall = { kind: 'command', subject: 'make check' };
const UUID = '11111111-1111-4111-8111-111111111111' as MessageUuid;
/** The pressed blocked row: `make build`'s call `t1` in the transcripts below. */
const PRESSED = 'cell:t1' as CellId;
const OPENING = 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: ';

let fake: FakeClient;
beforeEach(() => {
  resetGrantsOut();
  resetQueueStore();
  resetLaneAStore();
  resetRemoteLaneBStore();
  useSessions.setState({ records: new Map(), engine: new Map(), listed: new Map(), listedMachines: new Set() });
  useTranscriptStore.setState({ entries: {} });
  fake = fakeClient({ 'session.queue.list': { entries: [], paused: false } });
  window.maws = fake.client as unknown as PreloadBridge;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetGrantsOut();
  delete (window as { maws?: PreloadBridge }).maws;
});

const ready = (id: AppSessionId, over: Parameters<typeof status>[1] = {}) => useSessions.getState().applyStatus({ appSessionId: id, status: status(id, over) }, TEST_MACHINE);
const onTerminal = (id: AppSessionId, turn = { running: false, unknown: false }) => {
  useSessions.setState({ records: new Map([[id, record(id, { holder: { kind: 'terminal', pid: 42 } })]]) });
  applyLaneAState(id, laneAState(id, { turn }));
};
const queueOf = (id: AppSessionId, over: Partial<SessionQueue>) =>
  useQueueStore.setState((s) => ({ bySession: new Map(s.bySession).set(id, { entries: [], paused: false, pauseReason: null, steers: [], withdrawn: [], loaded: true, ...over }) }));
const entry = (id: AppSessionId, content: string, state: QueueEntry['state'] = 'queued'): QueueEntry => ({
  queueId: `q-${state}`, appSessionId: id, content, createdAt: T0, state, messageUuid: null, submittedAt: null, uncertain: false, steer: false,
});
const grant = (call: BlockedCall) => consentMessage(call.kind, call.subject);
/** Events of a later batch, with ids of their own (a builder numbers its events from e0, which the store has seen). */
const later = (events: SessionEvent[], name: string): SessionEvent[] => events.map((event, i) => ({ ...event, id: `${name}-${i}` }) as SessionEvent);
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};
async function answer(name: 'session.send' | 'session.steer', value: unknown) {
  const answered = fake.reply(name, value);
  await vi.advanceTimersByTimeAsync(0);
  await answered;
  await flush();
}

/** A transcript with one blocked `make build`, at the session's address, and a push for later batches. */
async function blockedSession(key: AppSessionId) {
  const b = builder();
  b.turn('u1');
  b.toolUse('t1', 'Bash', { command: 'make build' });
  b.result('t1', `${OPENING}Builds. If you have other tasks`, { isError: true, denial: 'automode-blocked' });
  b.end(['u1']);
  let listener: ((events: SessionEvent[]) => void) | null = null;
  const source: TranscriptSource = { key, subscribe: (l) => ((listener = l), () => (listener = null)), snapshot: () => Promise.resolve(b.events) };
  await useTranscriptStore.getState().attach(key, source);
  return { push: (events: SessionEvent[]) => listener?.(events) };
}

describe('a terminal session’s state (Design 7; Decision Log 5)', () => {
  it('running while its bridge says a turn runs or does not know, and with no state heard; else stopped when the newest turn reads stopped; else idle', async () => {
    const id = at('terminal-state') as AppSessionId;
    expect(terminalStateOf(id), 'no state heard').toBe('running');
    onTerminal(id, { running: true, unknown: false });
    expect(terminalStateOf(id)).toBe('running');
    onTerminal(id, { running: false, unknown: true });
    expect(terminalStateOf(id)).toBe('running');
    onTerminal(id, { running: false, unknown: false });
    expect(terminalStateOf(id), 'no transcript').toBe('idle');
    const b = builder();
    b.turn('u1');
    b.end(['u1']);
    b.turn('u2');
    b.end(['u2'], { terminalReason: 'aborted_streaming', isError: true, result: 'error_during_execution' });
    await useTranscriptStore.getState().attach(id, { key: id, subscribe: () => () => {}, snapshot: () => Promise.resolve(b.events) });
    expect(terminalStateOf(id), 'the newest turn stopped').toBe('stopped');
    const after = builder('2026-09-28T12:00:00.000Z');
    after.turn('u3');
    after.end(['u3']);
    await useTranscriptStore.getState().attach(at('terminal-state-2'), { key: at('terminal-state-2'), subscribe: () => () => {}, snapshot: () => Promise.resolve([...b.events, ...later(after.events, 'after')]) });
    onTerminal(at('terminal-state-2') as AppSessionId);
    expect(terminalStateOf(at('terminal-state-2') as AppSessionId), 'a turn after the stopped one').toBe('idle');
  });

  it('the words of each row of the table, with its values set: none offered, the widget’s words; running while idle is offered, the terminal’s queue; stopped while idle is offered, the widget’s; an offered state, none', () => {
    const none = { idle: false, running: false, stopped: false };
    for (const state of ['idle', 'running', 'stopped'] as const) expect(terminalRefusal(state, none), state).toBe(LANE_A_WORDS.widget);
    const idle = { idle: true, running: false, stopped: false };
    expect(terminalRefusal('idle', idle)).toBeNull();
    expect(terminalRefusal('running', idle)).toBe(TERMINAL_KEEPS_NO_QUEUE);
    expect(terminalRefusal('stopped', idle)).toBe(LANE_A_WORDS.widget);
    const all = { idle: true, running: true, stopped: true };
    for (const state of ['idle', 'running', 'stopped'] as const) expect(terminalRefusal(state, all), state).toBeNull();
  });

  it('ships with no state offered (M3; M4 turns each by its recording)', () => {
    expect(TERMINAL_OFFERED).toEqual({ idle: false, running: false, stopped: false });
  });
});

describe('the grants the record holds unread outside the transcript (Design 5)', () => {
  it('a queue entry queued or submitting, not released; a listed steer; each for its own key', () => {
    const id = at('waiting-queue') as AppSessionId;
    for (const state of ['queued', 'submitting'] as const) {
      queueOf(id, { entries: [entry(id, grant(BUILD), state)] });
      expect([...waitingGrants(id)], state).toEqual([blockedKey(BUILD)]);
    }
    queueOf(id, { entries: [entry(id, grant(BUILD), 'released')] });
    expect([...waitingGrants(id)], 'released: the running turn').toEqual([]);
    queueOf(id, { steers: [{ messageUuid: UUID, content: grant(CHECK), createdAt: T0 }] });
    expect([...waitingGrants(id)]).toEqual([blockedKey(CHECK)]);
    expect(waitingGrants(id).has(blockedKey(BUILD)), 'another key').toBe(false);
  });

  it('a terminal session’s pending send while sending or unconfirmed, not once refused', () => {
    const id = at('waiting-lane-a') as AppSessionId;
    holdPendingSend(id, { writer: 'maws/m', seq: 1 }, grant(BUILD));
    expect([...waitingGrants(id)], 'sending').toEqual([blockedKey(BUILD)]);
    for (const state of ['unconfirmed', 'refused'] as const) {
      useLaneA.setState({ pendingSends: new Map([[id, [{ key: { writer: 'maws/m', seq: 1 }, text: grant(BUILD), state, reason: null }]]]) });
      expect([...waitingGrants(id)], state).toEqual(state === 'unconfirmed' ? [blockedKey(BUILD)] : []);
    }
  });

  it('a waiting message that holds a grant line among other words waits for that key; one that only quotes it inside a sentence does not', () => {
    const id = at('waiting-words') as AppSessionId;
    queueOf(id, { entries: [entry(id, `Go ahead with this one.\n${grant(BUILD)}`)] });
    expect([...waitingGrants(id)]).toEqual([blockedKey(BUILD)]);
    queueOf(id, { entries: [entry(id, `I said: ${grant(BUILD)}`)] });
    expect([...waitingGrants(id)]).toEqual([]);
  });
});

describe('the gate (Design 6): closed over unavailable over open', () => {
  it('open on a session MAWS runs whose port takes a message', () => {
    const id = at('gate-open') as AppSessionId;
    ready(id);
    expect(gateOf(id, BUILD, 'none')).toEqual({ state: 'open' });
  });

  it('closed over open: a grant the row says waits, one the queue lists, one out', async () => {
    const id = at('gate-closed') as AppSessionId;
    ready(id);
    expect(gateOf(id, BUILD, 'waiting')).toEqual({ state: 'closed' });
    queueOf(id, { entries: [entry(id, grant(BUILD))] });
    expect(gateOf(id, BUILD, 'none')).toEqual({ state: 'closed' });
    expect(gateOf(id, CHECK, 'none'), 'another key').toEqual({ state: 'open' });
    queueOf(id, { entries: [] });
    vi.useFakeTimers();
    void approve(id, CHECK, PRESSED);
    expect(gateOf(id, CHECK, 'none'), 'out').toEqual({ state: 'closed' });
  });

  it('closed over unavailable: a waiting grant on a session no port drives', () => {
    const id = at('gate-closed-held') as AppSessionId;
    useSessions.setState({ records: new Map([[id, record(id, { holder: { kind: 'terminal', pid: 42 } })]]) });
    expect(gateOf(id, BUILD, 'none').state).toBe('unavailable');
    expect(gateOf(id, BUILD, 'waiting')).toEqual({ state: 'closed' });
  });

  it('unavailable over open, each in the words that exist: no port, the holder’s; a terminal session’s state not offered, the table’s; the port’s own answer to send', () => {
    const held = at('gate-held') as AppSessionId;
    useSessions.setState({ records: new Map([[held, record(held, { holder: { kind: 'terminal', pid: 42 } })]]) });
    expect(gateOf(held, BUILD, 'none')).toEqual({ state: 'unavailable', reason: expect.stringMatching(/^Held by /) });
    const terminal = at('gate-terminal') as AppSessionId;
    onTerminal(terminal);
    expect(gateOf(terminal, BUILD, 'none')).toEqual({ state: 'unavailable', reason: LANE_A_WORDS.widget });
    const remote = addressOf(OTHER_MACHINE, 'app-closed' as AppSessionId);
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: T0, generation: 0 }]);
    useSessions.setState({ listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, 'app-closed', { lane: 'B' }), appId: remote }]]), listedMachines: new Set([OTHER_MACHINE]), records: new Map([[remote, record(remote)]]) });
    applyRemoteSession(remoteSessionState(remote, { controls: { ...ALL_OPEN, send: { available: false, reason: 'Studio’s link is down' } } }));
    expect(gateOf(remote, BUILD, 'none')).toEqual({ state: 'unavailable', reason: 'Studio’s link is down' });
  });
});

describe('what a press sends (Design 5 and 7)', () => {
  it('GRANT_DURING_TURN’s two values: after the turn, a session MAWS runs is asked to keep it (`when: after`); at the next step it is sent as Enter sends; a terminal session never gets `when`', () => {
    const lane = at('options-b') as AppSessionId;
    ready(lane);
    expect(grantOptions(lane, 'after')).toEqual({ origin: 'answer', when: 'after' });
    expect(grantOptions(lane, 'next')).toEqual({ origin: 'answer' });
    const terminal = at('options-a') as AppSessionId;
    onTerminal(terminal);
    expect(grantOptions(terminal, 'after')).toEqual({ origin: 'answer' });
    expect(grantOptions(terminal, 'next')).toEqual({ origin: 'answer' });
    expect(grantOptions(lane)).toEqual(grantOptions(lane, GRANT_DURING_TURN));
  });

  it('through the port, both values, while a turn runs: after the turn is one session.send that the host keeps; the next step is one session.steer at `next`; idle, both are one session.send', async () => {
    const id = at('options-port') as AppSessionId;
    const client = fakeClient({ 'session.queue.list': { entries: [], paused: false }, 'session.send': { disposition: 'queued', messageUuid: null, queueId: 'q-1' }, 'session.steer': { messageUuid: UUID } });
    ready(id, { turn: humanTurn });
    expect(await sendToSession(id, grant(BUILD), grantOptions(id, 'after'), client.client)).toMatchObject({ disposition: 'queued' });
    expect(await sendToSession(id, grant(BUILD), grantOptions(id, 'next'), client.client)).toMatchObject({ disposition: 'steered' });
    expect(client.invoked('session.send')).toEqual([{ appSessionId: id, content: grant(BUILD) }]);
    expect(client.invoked('session.steer')).toEqual([{ appSessionId: id, content: grant(BUILD), priority: 'next' }]);
    ready(id);
    await sendToSession(id, grant(BUILD), grantOptions(id, 'after'), client.client);
    await sendToSession(id, grant(BUILD), grantOptions(id, 'next'), client.client);
    expect(client.invoked('session.send')).toHaveLength(3);
    expect(client.invoked('session.steer')).toHaveLength(1);
  });

  it('a session MAWS runs, while a turn runs: the press is the sentence as one session.steer at the next step, `origin: answer` (GRANT_DURING_TURN, probe B)', async () => {
    expect(GRANT_DURING_TURN).toBe('next');
    const id = at('press-b') as AppSessionId;
    ready(id, { turn: humanTurn });
    vi.useFakeTimers();
    void approve(id, BUILD, PRESSED);
    await flush();
    expect(fake.invoked('session.steer')).toEqual([{ appSessionId: 'press-b', content: grant(BUILD), priority: 'next' }]);
    expect(fake.invoked('session.send')).toEqual([]);
  });

  // Acceptance 8 as Decision Log 29 rewrites it: the press sends as Enter does on that machine
  const onStudio = () => {
    const remote = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: T0, generation: 0 }]);
    useSessions.setState({ listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, 'app-r', { lane: 'B' }), appId: remote }]]), listedMachines: new Set([OTHER_MACHINE]), records: new Map([[remote, record(remote)]]) });
    applyRemoteSession(remoteSessionState(remote));
    return remote;
  };

  it('another machine’s session with a running status held (Acceptance 8): the press is one session.steer at the next step with the sentence, and no send', async () => {
    const remote = onStudio();
    useSessions.getState().applyStatus({ appSessionId: remote, status: status(remote, { turn: humanTurn }) }, OTHER_MACHINE);
    vi.useFakeTimers();
    void approve(remote, BUILD, PRESSED);
    await flush();
    expect(fake.invoked('session.steer')).toEqual([{ appSessionId: 'app-r', content: grant(BUILD), priority: 'next' }]);
    expect(fake.invoked('session.send')).toEqual([]);
  });

  it('another machine’s session with no status held, and with one held and no turn running (Acceptance 8): the press is one session.send with the sentence, and no steer', async () => {
    const remote = onStudio();
    vi.useFakeTimers();
    void approve(remote, BUILD, PRESSED);
    await flush();
    await answer('session.send', { disposition: 'queued', messageUuid: null, queueId: 'q-1' });
    resetGrantsOut();
    useSessions.getState().applyStatus({ appSessionId: remote, status: status(remote) }, OTHER_MACHINE);
    void approve(remote, BUILD, PRESSED);
    await flush();
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: 'app-r', content: grant(BUILD) }, { appSessionId: 'app-r', content: grant(BUILD) }]);
    expect(fake.invoked('session.steer')).toEqual([]);
  });

  it('a session no port drives: nothing is sent, and the gate says who holds it', async () => {
    const id = at('press-held') as AppSessionId;
    useSessions.setState({ records: new Map([[id, record(id, { holder: { kind: 'terminal', pid: 42 } })]]) });
    await approve(id, BUILD, PRESSED);
    expect(fake.calls.filter((call) => call.startsWith('invoke'))).toEqual([]);
    expect(useGrantsOut.getState().out.size).toBe(0);
  });

  it('a terminal session with no state offered: nothing reaches the bridge', async () => {
    const id = at('press-terminal') as AppSessionId;
    onTerminal(id);
    await approve(id, BUILD, PRESSED);
    expect(fake.invoked('laneA.send')).toEqual([]);
  });
});

describe('the grant that is out (Design 4)', () => {
  it('a second press does not send twice: two presses in one tick, and a third while the first is unanswered, send one grant', async () => {
    const id = at('twice') as AppSessionId;
    ready(id);
    vi.useFakeTimers();
    void approve(id, BUILD, PRESSED);
    void approve(id, BUILD, PRESSED);
    await flush();
    void approve(id, BUILD, PRESSED);
    await flush();
    expect(fake.invoked('session.send')).toHaveLength(1);
  });

  it('a send that throws or is refused ends it with the words as the notice; the next press clears the notice', async () => {
    const id = at('notice') as AppSessionId;
    ready(id);
    vi.useFakeTimers();
    void approve(id, BUILD, PRESSED);
    await flush();
    const failed = fake.fail('session.send', 'The engine host could not take the message');
    await vi.advanceTimersByTimeAsync(0);
    await failed;
    await flush();
    expect([...useGrantsOut.getState().out.keys()]).toEqual([]);
    expect([...useGrantsOut.getState().notices.values()]).toEqual(['The engine host could not take the message']);
    void approve(id, BUILD, PRESSED);
    expect([...useGrantsOut.getState().notices.values()]).toEqual([]);
  });

  it('an event without the mark (a host of build F) leaves the row unapproved and ends the grant out by its clock', async () => {
    const id = at('build-f') as AppSessionId;
    ready(id);
    const transcript = await blockedSession(id);
    vi.useFakeTimers();
    void approve(id, BUILD, PRESSED);
    await flush();
    await answer('session.send', { disposition: 'sent', messageUuid: UUID, queueId: 'q-1' });
    const b = builder('2026-09-28T11:00:00.000Z');
    b.turn(UUID, grant(BUILD)); // the person's bubble: no consent mark
    act(() => transcript.push(later(b.events, 'bubble')));
    expect(useTranscriptStore.getState().rows(id).some((row) => row.kind === 'user' && row.text === grant(BUILD) && row.consent === undefined), 'the person’s bubble is drawn').toBe(true);
    expect(useGrantsOut.getState().out.size, 'no evidence: the clock decides').toBe(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(useGrantsOut.getState().out.size).toBe(0);
    expect(gateOf(id, BUILD, 'none')).toEqual({ state: 'open' });
  });

  it('follows the transcript, the queue, the lane A store, the sessions and the roster only while a grant is out', async () => {
    const id = at('follows') as AppSessionId;
    ready(id);
    const offs: ReturnType<typeof vi.fn>[] = [];
    for (const store of [useTranscriptStore, useQueueStore, useLaneA, useSessions, useMachines] as { subscribe: (listener: () => void) => () => void }[]) {
      const subscribe = store.subscribe.bind(store);
      vi.spyOn(store, 'subscribe').mockImplementation((listener: () => void) => {
        const off = vi.fn(subscribe(listener));
        offs.push(off);
        return off;
      });
    }
    vi.useFakeTimers();
    void approve(id, BUILD, PRESSED);
    expect(offs, 'the five the store follows, and the transcript store once more for the session’s hold (hold.ts)').toHaveLength(6);
    await flush();
    await answer('session.send', { disposition: 'sent', messageUuid: UUID, queueId: 'q-1' });
    expect(offs.every((off) => off.mock.calls.length === 0), 'while it is out').toBe(true);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(useGrantsOut.getState().out.size).toBe(0);
    expect(offs.map((off) => off.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 1]);
  });
});

// M3's review, fix 1. An answer belongs to its own press (finding 2); the store keeps alive what it reads while a grant is
// out, whatever is mounted, and lets go when the session's last grant ends or the session goes (finding 3); and the count
// a press compares runs only over the approval rows after the pressed cell (finding 1, as the coordinator ruled).
describe('the grant that is out, against what outlives a press (M3’s review, fix 1)', () => {
  const G = '22222222-2222-4222-8222-222222222222' as MessageUuid;
  const G0 = '33333333-3333-4333-8333-333333333333' as MessageUuid;

  /** The host's echo of a grant it was handed, waiting at the next step (the steer's row), with the person's mark. */
  const echo = (uuid: MessageUuid, name: string) => {
    const b = builder('2026-09-28T11:00:00.000Z');
    b.emit('user.message', { messageUuid: uuid, content: grant(BUILD), isReplay: false, isSynthetic: false, origin: 'human', bash: null, arrival: [{ class: 'consent', kind: 'command', subject: 'make build' }] });
    return later(b.events, name);
  };
  const withdrawn = (uuid: MessageUuid, name: string) => {
    const b = builder('2026-09-28T11:01:00.000Z');
    b.emit('command.lifecycle', { commandUuid: uuid, state: 'cancelled' });
    return later(b.events, name);
  };
  /** A's echo comes before A's send answers, and ends A; the echo is withdrawn; B is pressed on the same key, unanswered. */
  async function aEndedThenB(name: string) {
    const id = at(name) as AppSessionId;
    ready(id);
    const transcript = await blockedSession(id);
    vi.useFakeTimers();
    void approve(id, BUILD, PRESSED);
    await flush();
    act(() => transcript.push(echo(UUID, 'echo-a')));
    expect(useGrantsOut.getState().out.size, 'A ends on its own approval row').toBe(0);
    act(() => transcript.push(withdrawn(UUID, 'withdrawn-a')));
    expect(gateOf(id, BUILD, 'none'), 'withdrawn: the button returns').toEqual({ state: 'open' });
    void approve(id, BUILD, PRESSED);
    await flush();
    expect(fake.invoked('session.send'), 'A and B, each one send').toHaveLength(2);
    return id;
  }

  it('a late refusal of an earlier press leaves the newer press’s grant out: no notice, and no third send', async () => {
    const id = await aEndedThenB('late-refusal');
    const failed = fake.fail('session.send', 'The engine host could not take the message'); // the oldest: A’s
    await vi.advanceTimersByTimeAsync(0);
    await failed;
    await flush();
    expect(useGrantsOut.getState().out.size, 'B is still out').toBe(1);
    expect([...useGrantsOut.getState().notices.values()], 'A’s words are no answer to B').toEqual([]);
    void approve(id, BUILD, PRESSED);
    await flush();
    expect(fake.invoked('session.send')).toHaveLength(2);
  });

  it('a late success of an earlier press does not start the newer press’s clock: B, unanswered, stays out past SETTLE_MS', async () => {
    await aEndedThenB('late-success');
    await answer('session.send', { disposition: 'sent', messageUuid: UUID, queueId: 'q-1' }); // the oldest: A’s
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 3);
    expect([...useGrantsOut.getState().out.values()].map((out) => out.phase), 'B, still sending').toEqual(['sending']);
  });

  /** A pane over the session as the app mounts one: the composer's queue attachment, and the transcript's source. */
  async function pane(id: AppSessionId) {
    const releaseQueue = attachQueue(id, fake.client);
    const transcript = await blockedSession(id);
    await flush();
    return { transcript, close: () => (releaseQueue(), useTranscriptStore.getState().detach(id)) };
  }
  // the pane's composer attaches over the bridge itself (as the queue's own tests do), so its events carry the address;
  // the host's answer to a read through the page's client carries the bare id the client lifts
  const queued = (appSessionId: AppSessionId) => ({ queueId: 'q-g', appSessionId, content: grant(BUILD), createdAt: T0, state: 'queued' as const, messageUuid: null, submittedAt: null, uncertain: false, steer: false });
  const queueEvent = (id: AppSessionId, entries: unknown[]) => act(() => fake.event('session.queue', { appSessionId: id, entries, paused: false, pauseReason: null }));

  it('the pane closed, its composer and its source let go: the queue’s word still reaches the grant, which ends by its clock once the grant is removed elsewhere', async () => {
    const id = at('pane-closed') as AppSessionId;
    ready(id);
    const view = await pane(id);
    vi.useFakeTimers();
    void approve(id, BUILD, PRESSED);
    await flush();
    await answer('session.send', { disposition: 'queued', messageUuid: null, queueId: 'q-g' });
    queueEvent(id, [queued(id)]);
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 3);
    expect(useGrantsOut.getState().out.size, 'listed: the clock is stopped').toBe(1);
    view.close();
    expect(useTranscriptStore.getState().attached(id), 'the grant keeps the transcript attached').toBe(true);
    queueEvent(id, []);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(useGrantsOut.getState().out.size, 'removed elsewhere: the clock ran').toBe(0);
    expect(useTranscriptStore.getState().attached(id), 'the last grant ended: let go').toBe(false);
    queueEvent(id, [queued(id)]);
    expect(useQueueStore.getState().bySession.get(id)?.entries, 'the queue no longer followed').toEqual([]);
  });

  it('the pane closed: the transcript’s approval row still reaches the grant, which ends at once', async () => {
    const id = at('pane-closed-row') as AppSessionId;
    ready(id);
    const view = await pane(id);
    vi.useFakeTimers();
    void approve(id, BUILD, PRESSED);
    await flush();
    await answer('session.send', { disposition: 'queued', messageUuid: null, queueId: 'q-g' });
    queueEvent(id, [queued(id)]);
    view.close();
    act(() => view.transcript.push(echo(G, 'echo')));
    expect(useGrantsOut.getState().out.size).toBe(0);
  });

  it('the pane closed before any waiting snapshot: the grant reads the queue itself, and the guard does not run out while the queue lists it', async () => {
    const id = at('no-snapshot') as AppSessionId;
    ready(id);
    const view = await pane(id); // its snapshot: an empty queue
    view.close();
    let listed: unknown[] = [];
    fake = fakeClient({ 'session.queue.list': () => ({ entries: listed, paused: false }) });
    window.maws = fake.client as unknown as PreloadBridge;
    vi.useFakeTimers();
    listed = [queued(bareOf(id))]; // the host queued it before its answer
    void approve(id, BUILD, PRESSED);
    await flush();
    await answer('session.send', { disposition: 'queued', messageUuid: null, queueId: 'q-g' });
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 3);
    expect(useGrantsOut.getState().out.size, 'the queue lists it: no clock').toBe(1);
  });

  it('the session goes (its record removed; another machine’s, its machine gone from the roster): its grants end and nothing it held stays attached', async () => {
    const id = at('goes') as AppSessionId;
    useSessions.setState({ records: new Map([[id, record(id)]]) });
    ready(id);
    const view = await pane(id);
    vi.useFakeTimers();
    void approve(id, BUILD, PRESSED);
    await flush();
    view.close();
    expect(useTranscriptStore.getState().attached(id)).toBe(true);
    act(() => useSessions.setState({ records: new Map() }));
    expect(useGrantsOut.getState().out.size).toBe(0);
    expect(useTranscriptStore.getState().attached(id), 'nothing outlives its session').toBe(false);

    const remote = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: T0, generation: 0 }]);
    useSessions.setState({ listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, 'app-r', { lane: 'B' }), appId: remote }]]), listedMachines: new Set([OTHER_MACHINE]), records: new Map([[remote, record(remote)]]) });
    applyRemoteSession(remoteSessionState(remote));
    const there = await pane(remote);
    void approve(remote, BUILD, PRESSED);
    await flush();
    there.close();
    expect(useTranscriptStore.getState().attached(remote)).toBe(true);
    act(() => useMachines.getState().applyRoster([]));
    expect(useGrantsOut.getState().out.size).toBe(0);
    expect(useTranscriptStore.getState().attached(remote)).toBe(false);
  });

  /** A session whose history comes in pages: the newest holds `make build` blocked (t1); an older page joins later. */
  async function paged(id: AppSessionId, first?: SessionEvent[]) {
    const b = builder('2026-09-28T10:00:00.000Z');
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'make build' });
    b.result('t1', `${OPENING}Builds. If you have other tasks`, { isError: true, denial: 'automode-blocked' });
    b.end(['u1']);
    let events = first ?? later(b.events, 'newest');
    let listener: ((batch: SessionEvent[]) => void) | null = null;
    let rebuild: (() => void) | null = null;
    const source: TranscriptSource = {
      key: id,
      subscribe: (l) => ((listener = l), () => (listener = null)),
      snapshot: () => Promise.resolve(events),
      onRebuild: (l) => ((rebuild = l), () => (rebuild = null)),
    };
    await useTranscriptStore.getState().attach(id, source);
    return {
      push: (batch: SessionEvent[]) => {
        events = [...events, ...batch];
        act(() => listener?.(batch));
      },
      older: async (page: SessionEvent[]) => {
        events = [...page, ...events];
        act(() => rebuild?.());
        await flush();
      },
    };
  }
  /** An earlier block of the same command (t0) and the person's read approval of it: the older page. */
  const earlier = () => {
    const b = builder('2026-09-28T09:00:00.000Z');
    b.turn('u0');
    b.toolUse('t0', 'Bash', { command: 'make build' });
    b.result('t0', `${OPENING}Builds. If you have other tasks`, { isError: true, denial: 'automode-blocked' });
    b.end(['u0']);
    b.emit('turn.started', { userMessageUuid: G0, origin: 'human' });
    b.emit('user.message', { messageUuid: G0, content: grant(BUILD), isReplay: false, isSynthetic: false, origin: 'human', bash: null, arrival: [{ class: 'consent', kind: 'command', subject: 'make build' }] });
    b.end([G0]);
    return later(b.events, 'older');
  };
  const approvalOfThisPress = () => {
    const b = builder('2026-09-28T11:00:00.000Z');
    b.emit('turn.started', { userMessageUuid: G, origin: 'human' });
    b.emit('user.message', { messageUuid: G, content: grant(BUILD), isReplay: false, isSynthetic: false, origin: 'human', bash: null, arrival: [{ class: 'consent', kind: 'command', subject: 'make build' }] });
    return later(b.events, 'this-press');
  };

  it('an older page that holds an earlier approval of the same command does not end the grant; the approval of this press, after the pressed row, does (finding 1)', async () => {
    const id = at('older-page') as AppSessionId;
    ready(id);
    const history = await paged(id);
    vi.useFakeTimers();
    void approve(id, BUILD, PRESSED);
    await flush();
    await answer('session.send', { disposition: 'sent', messageUuid: G, queueId: 'q-1' });
    await history.older(earlier());
    const { rows, state } = useTranscriptStore.getState().entries[id]!;
    expect(rows.some((row) => row.kind === 'user' && row.consent !== undefined), 'the earlier approval is held').toBe(true);
    expect(expandedTurnRows(state, state.index.toolUses.get('t1' as never)!).some((row) => row.id === PRESSED), 'the pressed row keeps its id through the rebuild').toBe(true);
    expect(useGrantsOut.getState().out.size, 'an approval before the pressed row is no answer to it').toBe(1);
    history.push(approvalOfThisPress());
    expect(useGrantsOut.getState().out.size).toBe(0);
  });

  it('the command blocked twice in one transcript: a press on the later row is not ended by the approval between the two rows, through a rebuild; its own approval ends it (finding 1)', async () => {
    const id = at('blocked-twice') as AppSessionId;
    ready(id);
    const history = await paged(id);
    await history.older(earlier());
    vi.useFakeTimers();
    void approve(id, BUILD, PRESSED);
    await flush();
    await answer('session.send', { disposition: 'sent', messageUuid: G, queueId: 'q-1' });
    await history.older([]);
    expect(useGrantsOut.getState().out.size).toBe(1);
    history.push(approvalOfThisPress());
    expect(useGrantsOut.getState().out.size).toBe(0);
  });

  it('a press during a running turn on a row blocked again: the turn ends and folds its work away, the earlier approval still held, and the grant stays out; this press’s approval ends it (finding 1)', async () => {
    const id = at('again-folds') as AppSessionId;
    ready(id, { turn: humanTurn });
    const b = builder('2026-09-28T10:00:00.000Z');
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'make build' });
    b.result('t1', `${OPENING}Builds. If you have other tasks`, { isError: true, denial: 'automode-blocked' });
    b.toolUse('t-held', 'Bash', { command: 'sleep 30' });
    const history = await paged(id, [...earlier(), ...later(b.events, 'running')]);
    vi.useFakeTimers();
    expect(useTranscriptStore.getState().rows(id).some((row) => row.id === PRESSED), 'the turn runs: the row is drawn').toBe(true);
    void approve(id, BUILD, PRESSED);
    await flush();
    await answer('session.steer', { messageUuid: G });
    const ended = builder('2026-09-28T10:30:00.000Z');
    ended.result('t-held', 'done', { structured: { stdout: 'done', stderr: '', interrupted: false, isImage: false, noOutputExpected: false } });
    ended.end(['u1']);
    history.push(later(ended.events, 'ended'));
    expect(useTranscriptStore.getState().rows(id).some((row) => row.id === PRESSED), 'the turn closed: its work folded away').toBe(false);
    expect(useGrantsOut.getState().out.size, 'the approval before the pressed row is no answer to it').toBe(1);
    history.push(approvalOfThisPress());
    expect(useGrantsOut.getState().out.size).toBe(0);
  });

  it('the expansion of the pressed call’s turn runs only while a grant is out: a store change with none out expands nothing; with one out, one turn per count', async () => {
    const id = at('expansions') as AppSessionId;
    ready(id);
    const history = await paged(id);
    vi.useFakeTimers();
    expect(useTranscriptStore.getState().rows(id).some((row) => row.id === PRESSED), 'the turn is closed: its work is folded away').toBe(false);
    const before = pressedTurnExpansions.count;
    act(() => useTranscriptStore.getState().setFollowing(id, false));
    act(() => useQueueStore.setState({ bySession: new Map() }));
    history.push(approvalOfThisPress());
    expect(pressedTurnExpansions.count, 'no grant out').toBe(before);
    void approve(id, CHECK, PRESSED);
    expect(pressedTurnExpansions.count - before, 'the press’s own count').toBe(1);
    await flush();
    const settled = pressedTurnExpansions.count;
    act(() => useQueueStore.setState({ bySession: new Map() }));
    expect(pressedTurnExpansions.count - settled, 'one store change, one turn').toBe(1);
  });
});
