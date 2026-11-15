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
import { addressOf } from '@shared/machine/address';
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
import { resetQueueStore, useQueueStore, type SessionQueue } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import { blockedKey, type BlockedCall } from '../transcript/model/blocked';
import { builder } from '../transcript/model/test-events';
import type { TranscriptSource } from '../transcript/source/types';
import { approve, gateOf, GRANT_DURING_TURN, grantOptions, resetGrantsOut, SETTLE_MS, TERMINAL_OFFERED, terminalRefusal, terminalStateOf, useGrantsOut, waitingGrants } from './grants';

const BUILD: BlockedCall = { kind: 'command', subject: 'make build' };
const CHECK: BlockedCall = { kind: 'command', subject: 'make check' };
const UUID = '11111111-1111-4111-8111-111111111111' as MessageUuid;
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
    await useTranscriptStore.getState().attach(at('terminal-state-2'), { key: at('terminal-state-2'), subscribe: () => () => {}, snapshot: () => Promise.resolve([...b.events, ...after.events]) });
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
    void approve(id, CHECK);
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

  it('a session MAWS runs: the press is the sentence, `origin: answer`, at GRANT_DURING_TURN’s value', async () => {
    const id = at('press-b') as AppSessionId;
    ready(id, { turn: humanTurn });
    vi.useFakeTimers();
    void approve(id, BUILD);
    await flush();
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: 'press-b', content: grant(BUILD) }]);
    expect(fake.invoked('session.steer')).toEqual([]);
  });

  it('another machine’s session (Acceptance 8): the press is one session.send with the sentence as its content and no steer, idle and while a turn runs there', async () => {
    const remote = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: T0, generation: 0 }]);
    useSessions.setState({ listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, 'app-r', { lane: 'B' }), appId: remote }]]), listedMachines: new Set([OTHER_MACHINE]), records: new Map([[remote, record(remote)]]) });
    applyRemoteSession(remoteSessionState(remote));
    vi.useFakeTimers();
    useSessions.getState().applyStatus({ appSessionId: remote, status: status(remote) }, OTHER_MACHINE);
    void approve(remote, BUILD);
    await flush();
    await answer('session.send', { disposition: 'sent', messageUuid: UUID, queueId: 'q-1' });
    resetGrantsOut();
    useSessions.getState().applyStatus({ appSessionId: remote, status: status(remote, { turn: humanTurn }) }, OTHER_MACHINE);
    void approve(remote, BUILD);
    await flush();
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: 'app-r', content: grant(BUILD) }, { appSessionId: 'app-r', content: grant(BUILD) }]);
    expect(fake.invoked('session.steer')).toEqual([]);
  });

  it('a session no port drives: nothing is sent, and the gate says who holds it', async () => {
    const id = at('press-held') as AppSessionId;
    useSessions.setState({ records: new Map([[id, record(id, { holder: { kind: 'terminal', pid: 42 } })]]) });
    await approve(id, BUILD);
    expect(fake.calls.filter((call) => call.startsWith('invoke'))).toEqual([]);
    expect(useGrantsOut.getState().out.size).toBe(0);
  });

  it('a terminal session with no state offered: nothing reaches the bridge', async () => {
    const id = at('press-terminal') as AppSessionId;
    onTerminal(id);
    await approve(id, BUILD);
    expect(fake.invoked('laneA.send')).toEqual([]);
  });
});

describe('the grant that is out (Design 4)', () => {
  it('a second press does not send twice: two presses in one tick, and a third while the first is unanswered, send one grant', async () => {
    const id = at('twice') as AppSessionId;
    ready(id);
    vi.useFakeTimers();
    void approve(id, BUILD);
    void approve(id, BUILD);
    await flush();
    void approve(id, BUILD);
    await flush();
    expect(fake.invoked('session.send')).toHaveLength(1);
  });

  it('a send that throws or is refused ends it with the words as the notice; the next press clears the notice', async () => {
    const id = at('notice') as AppSessionId;
    ready(id);
    vi.useFakeTimers();
    void approve(id, BUILD);
    await flush();
    const failed = fake.fail('session.send', 'The engine host could not take the message');
    await vi.advanceTimersByTimeAsync(0);
    await failed;
    await flush();
    expect([...useGrantsOut.getState().out.keys()]).toEqual([]);
    expect([...useGrantsOut.getState().notices.values()]).toEqual(['The engine host could not take the message']);
    void approve(id, BUILD);
    expect([...useGrantsOut.getState().notices.values()]).toEqual([]);
  });

  it('an event without the mark (a host of build F) leaves the row unapproved and ends the grant out by its clock', async () => {
    const id = at('build-f') as AppSessionId;
    ready(id);
    const transcript = await blockedSession(id);
    vi.useFakeTimers();
    void approve(id, BUILD);
    await flush();
    await answer('session.send', { disposition: 'sent', messageUuid: UUID, queueId: 'q-1' });
    const b = builder('2026-09-28T11:00:00.000Z');
    b.turn(UUID, grant(BUILD)); // the person's bubble: no consent mark
    act(() => transcript.push(b.events));
    expect(useGrantsOut.getState().out.size, 'no evidence: the clock decides').toBe(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(useGrantsOut.getState().out.size).toBe(0);
    expect(gateOf(id, BUILD, 'none')).toEqual({ state: 'open' });
  });

  it('follows the transcript, the queue and the lane A store only while a grant is out', async () => {
    const id = at('follows') as AppSessionId;
    ready(id);
    const offs: ReturnType<typeof vi.fn>[] = [];
    for (const store of [useTranscriptStore, useQueueStore, useLaneA] as { subscribe: (listener: () => void) => () => void }[]) {
      const subscribe = store.subscribe.bind(store);
      vi.spyOn(store, 'subscribe').mockImplementation((listener: () => void) => {
        const off = vi.fn(subscribe(listener));
        offs.push(off);
        return off;
      });
    }
    vi.useFakeTimers();
    void approve(id, BUILD);
    expect(offs).toHaveLength(3);
    await flush();
    await answer('session.send', { disposition: 'sent', messageUuid: UUID, queueId: 'q-1' });
    expect(offs.every((off) => off.mock.calls.length === 0), 'while it is out').toBe(true);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(useGrantsOut.getState().out.size).toBe(0);
    expect(offs.map((off) => off.mock.calls.length)).toEqual([1, 1, 1]);
  });
});
