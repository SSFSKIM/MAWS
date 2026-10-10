import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { QueueEntry } from '@shared/engine/session-state-store';
import { humanTurn, record, status, T0 } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { resetComposerStore } from '../../stores/composer';
import { attachQueue, resetQueueStore } from '../../stores/queue';
import { useSessions } from '../../stores/sessions';
import { useSetup } from '../../sessions/store';
import { trustState } from '../../test-support/setup-intents';
import { sendHumanPrompt } from './send-human-prompt';

const APP = 'app-human' as AppSessionId;
const UUID = '11111111-1111-4111-8111-111111111111' as MessageUuid;
const entry: QueueEntry = { queueId: 'q1', appSessionId: APP, content: 'earlier', createdAt: '2026-10-08T00:00:00Z', state: 'submitting', messageUuid: UUID, submittedAt: '2026-10-08T00:00:01Z', uncertain: false, steer: false };
const sendResult = { disposition: 'sent', queueId: 'q2', messageUuid: UUID };
const makeClient = () => fakeClient({ 'session.send': sendResult, 'session.steer': { messageUuid: UUID }, 'session.queue.list': { entries: [], paused: false } });

beforeEach(() => {
  resetQueueStore();
  resetComposerStore();
  useSessions.setState({ engine: new Map(), digests: new Map(), records: new Map() });
  useSetup.setState({ cards: new Map() });
});
afterEach(() => {
  resetQueueStore();
});

const ready = (over: Parameters<typeof status>[1] = {}) => useSessions.getState().applyStatus({ appSessionId: APP, status: status(APP, over) });

describe('the human send seam', () => {
  it('sends when idle, returning the host uuid without recording composer history or passing origin to the engine', async () => {
    ready();
    const fake = makeClient();
    expect(await sendHumanPrompt(APP, 'answer', { origin: 'answer' }, fake.client)).toEqual({ disposition: 'sent', started: false, messageUuid: UUID });
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: APP, content: 'answer' }]);
    expect(fake.invoked('session.steer')).toEqual([]);
    expect(fake.invoked('session.history.append')).toEqual([]);
  });

  it('steers at the next boundary while a turn runs, never preempting it', async () => {
    ready({ turn: humanTurn });
    const fake = makeClient();
    expect(await sendHumanPrompt(APP, 'reply', { origin: 'reply' }, fake.client)).toEqual({ disposition: 'steered', started: false, messageUuid: UUID });
    expect(fake.invoked('session.steer')).toEqual([{ appSessionId: APP, content: 'reply', priority: 'next' }]);
    expect(fake.invoked('session.send')).toEqual([]);
  });

  it('treats a submitting queue entry as busy before the turn starts, including without a mounted composer', async () => {
    ready();
    const fake = fakeClient({ 'session.queue.list': { entries: [entry], paused: false }, 'session.steer': { messageUuid: UUID } });
    expect(await sendHumanPrompt(APP, 'comment', { origin: 'comment' }, fake.client)).toEqual({ disposition: 'steered', started: false, messageUuid: UUID });
    expect(fake.invoked('session.steer')).toEqual([{ appSessionId: APP, content: 'comment', priority: 'next' }]);
  });

  it('uses the mounted composer’s event-fed queue rather than reading it again', async () => {
    ready();
    const fake = makeClient();
    const off = attachQueue(APP, fake.client);
    fake.event('session.queue', { appSessionId: APP, entries: [entry], paused: false });
    expect(await sendHumanPrompt(APP, 'peer', { origin: 'peer' }, fake.client)).toEqual({ disposition: 'steered', started: false, messageUuid: UUID });
    expect(fake.invoked('session.queue.list')).toHaveLength(1);
    off();
  });

  it('does not invent a uuid for an idle send that joins a paused queue', async () => {
    ready();
    const fake = fakeClient({ 'session.queue.list': { entries: [{ ...entry, state: 'queued', messageUuid: null, submittedAt: null }], paused: true }, 'session.send': { disposition: 'queued', queueId: 'q2', messageUuid: null } });
    expect(await sendHumanPrompt(APP, 'later', { origin: 'composer' }, fake.client)).toEqual({ disposition: 'queued', started: false, queueId: 'q2' });
    expect(fake.invoked('session.steer')).toEqual([]);
  });

  it.each(['starting', 'initializing', 'exiting', 'exited'] as const)('refuses a %s process of a session with no record with a reason and writes nothing', async (process) => {
    ready({ process });
    const fake = makeClient();
    expect(await sendHumanPrompt(APP, 'reply', { origin: 'reply' }, fake.client)).toEqual({ disposition: 'refused', started: false, reason: process === 'starting' || process === 'initializing' ? 'Session is starting…' : 'Session ended' });
    expect(fake.invoked('session.send')).toEqual([]);
    expect(fake.invoked('session.steer')).toEqual([]);
  });

  it('reads status once when no composer has populated it yet', async () => {
    const fake = fakeClient({ 'session.status': status(APP), 'session.queue.list': { entries: [], paused: false }, 'session.send': sendResult });
    expect(await sendHumanPrompt(APP, 'hello', { origin: 'answer' }, fake.client)).toEqual({ disposition: 'sent', started: false, messageUuid: UUID });
    expect(fake.invoked('session.status')).toEqual([{ appSessionId: APP }]);
  });

  // P2-A start (2026-10-09; X22's final shape, the execution document §5.4): a session with a record and no ready
  // process is acquired first, then sent; `started` says this call launched it or joined a launch in flight
  describe('a session with a record and no ready process', () => {
    const known = () => useSessions.setState({ records: new Map([[APP, record(APP)]]) });
    const acquiring = (outcome: unknown) => fakeClient({ 'session.acquire': outcome, 'session.send': sendResult, 'session.steer': { messageUuid: UUID } });
    const readyOutcome = (launched: boolean, joined = false) => ({ status: 'ready', appSessionId: APP, launched, joined });
    const TRUST = trustState();

    it.each([null, 'exited', 'exiting', 'starting', 'initializing'] as const)('acquires (status %s), then sends once, answering started with the host’s uuid', async (process) => {
      known();
      if (process !== null) ready({ process });
      const fake = acquiring(readyOutcome(process === null || process === 'exited' || process === 'exiting', process === 'starting' || process === 'initializing'));
      expect(await sendHumanPrompt(APP, 'carry on', { origin: 'answer' }, fake.client)).toEqual({ disposition: 'sent', started: true, messageUuid: UUID });
      expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: APP, reason: 'send' }]);
      expect(fake.invoked('session.send')).toEqual([{ appSessionId: APP, content: 'carry on' }]);
      expect(fake.invoked('session.steer'), 'never a steer: the renderer’s status may trail the acquisition').toEqual([]);
      expect(fake.invoked('session.status')).toEqual([]);
    });

    it('passes the host’s queued answer through, with its queue id, when an earlier joined prompt is still in the host’s queue', async () => {
      known();
      const fake = fakeClient({ 'session.acquire': readyOutcome(true, true), 'session.send': { disposition: 'queued', queueId: 'q7', messageUuid: null } });
      expect(await sendHumanPrompt(APP, 'second', { origin: 'reply' }, fake.client)).toEqual({ disposition: 'queued', started: true, queueId: 'q7' });
    });

    it('answers started false when main found the engine ready already', async () => {
      known();
      const fake = acquiring(readyOutcome(false));
      expect(await sendHumanPrompt(APP, 'hi', { origin: 'answer' }, fake.client)).toEqual({ disposition: 'sent', started: false, messageUuid: UUID });
    });

    it('holds a composer message behind a trust card that shows it, sending nothing', async () => {
      known();
      const content = [{ type: 'text' as const, text: 'carry on' }];
      const fake = acquiring({ status: 'needs_trust', appSessionId: APP, trust: TRUST });
      expect(await sendHumanPrompt(APP, content, { origin: 'composer', display: '[Pasted text #1]' }, fake.client)).toEqual({ disposition: 'held', started: false, reason: 'trust' });
      expect(useSetup.getState().cards.get(APP)).toEqual({ kind: 'trust', trust: TRUST, message: { content, display: '[Pasted text #1]' } });
      expect(fake.invoked('session.send')).toEqual([]);
    });

    it('holds a composer message behind a relay card', async () => {
      known();
      const health = { url: 'http://127.0.0.1:8641', ok: false, status: null, latencyMs: null, checkedAt: T0, error: 'ECONNREFUSED' };
      const fake = acquiring({ status: 'relay_unreachable', appSessionId: APP, health });
      expect(await sendHumanPrompt(APP, 'carry on', { origin: 'composer' }, fake.client)).toEqual({ disposition: 'held', started: false, reason: 'relay' });
      expect(useSetup.getState().cards.get(APP)).toMatchObject({ kind: 'relay', message: { content: 'carry on', display: 'carry on' } });
    });

    it.each(['answer', 'reply', 'comment', 'peer'] as const)('never hands %s text to a card: the card docks without it and the seam refuses with the card’s words', async (origin) => {
      known();
      const fake = acquiring({ status: 'needs_trust', appSessionId: APP, trust: TRUST });
      expect(await sendHumanPrompt(APP, 'the answer', { origin }, fake.client)).toEqual({ disposition: 'refused', started: false, reason: 'Trust this folder in the session to continue' });
      expect(useSetup.getState().cards.get(APP)).toEqual({ kind: 'trust', trust: TRUST, message: null });
    });

    it('a card without a message never replaces the composer’s card of the same kind', async () => {
      known();
      useSetup.getState().dock(APP, { kind: 'trust', trust: TRUST, message: { content: 'mine', display: 'mine' } });
      const fake = acquiring({ status: 'needs_trust', appSessionId: APP, trust: TRUST });
      await sendHumanPrompt(APP, 'the answer', { origin: 'answer' }, fake.client);
      expect(useSetup.getState().cards.get(APP)).toMatchObject({ message: { content: 'mine' } });
    });

    it.each([
      [{ status: 'held', appSessionId: APP, holder: { kind: 'terminal', pid: 42 }, attach: null }, 'Held by terminal · 42'],
      [{ status: 'archived', appSessionId: APP }, 'Archived · unarchive it to continue'],
      [{ status: 'missing_directory', appSessionId: APP, directory: '/gone' }, 'Directory not found: /gone'],
      [{ status: 'failed', appSessionId: APP, message: 'the model is not available', resources: { worktree: null, record: 'kept', transcript: 'kept' } }, 'the model is not available'],
      [{ status: 'refused', appSessionId: APP, reason: 'unknown_session', message: 'no session record' }, 'no session record'],
    ])('refuses with the acquisition’s words and sends nothing (%o)', async (outcome, words) => {
      known();
      const fake = acquiring(outcome);
      expect(await sendHumanPrompt(APP, 'carry on', { origin: 'composer' }, fake.client)).toEqual({ disposition: 'refused', started: false, reason: words });
      expect(fake.invoked('session.send')).toEqual([]);
    });

    it('throws when the acquisition itself cannot be asked, so the caller’s Retry applies', async () => {
      known();
      const fake = fakeClient({ 'session.send': sendResult });
      const sending = sendHumanPrompt(APP, 'carry on', { origin: 'composer' }, fake.client);
      await vi.waitFor(() => expect(fake.pending('session.acquire')).toBe(1));
      const rejection = expect(sending).rejects.toThrow('main is gone');
      await fake.fail('session.acquire', 'main is gone');
      await rejection;
      expect(fake.invoked('session.send')).toEqual([]);
    });
  });
  // P2-A end

  // P2-F (L116): a caller's pre-check runs once the seam has decided the prompt may go, so a state refusal comes first
  describe("a caller's pre-check", () => {
    it.each(['exited', 'starting'] as const)('is not consulted when the seam refuses by state (no record, %s)', async (process) => {
      ready({ process });
      const precheck = vi.fn(() => true);
      const fake = makeClient();
      expect(await sendHumanPrompt(APP, 'hi', { origin: 'composer', precheck }, fake.client)).toMatchObject({ disposition: 'refused', started: false });
      expect(precheck).not.toHaveBeenCalled();
    });

    it('runs once before a dispatch; declining it sends nothing and answers refused with no reason', async () => {
      ready();
      const fake = makeClient();
      const precheck = vi.fn(() => true);
      expect(await sendHumanPrompt(APP, 'hi', { origin: 'composer', precheck }, fake.client)).toMatchObject({ disposition: 'sent' });
      expect(precheck).toHaveBeenCalledTimes(1);
      expect(await sendHumanPrompt(APP, 'hi', { origin: 'composer', precheck: () => false }, fake.client)).toEqual({ disposition: 'refused', started: false });
      expect(fake.invoked('session.send')).toHaveLength(1);
    });

    it('runs once before an acquisition; declining it starts nothing', async () => {
      useSessions.setState({ records: new Map([[APP, record(APP)]]) });
      ready({ process: 'exited' });
      const fake = fakeClient({ 'session.acquire': { status: 'ready', appSessionId: APP, launched: true, joined: false }, 'session.send': sendResult });
      expect(await sendHumanPrompt(APP, 'hi', { origin: 'composer', precheck: () => false }, fake.client)).toEqual({ disposition: 'refused', started: false });
      expect(fake.invoked('session.acquire')).toEqual([]);
      const precheck = vi.fn(() => true);
      expect(await sendHumanPrompt(APP, 'hi', { origin: 'composer', precheck }, fake.client)).toMatchObject({ disposition: 'sent', started: true });
      expect(precheck).toHaveBeenCalledTimes(1);
    });
  });

  it('propagates the host error rather than claiming the message was delivered', async () => {
    ready();
    const fake = fakeClient({ 'session.queue.list': { entries: [], paused: false } });
    const sending = sendHumanPrompt(APP, 'reply', { origin: 'reply' }, fake.client);
    await vi.waitFor(() => expect(fake.pending('session.send')).toBe(1));
    const rejection = expect(sending).rejects.toThrow('write failed');
    await fake.fail('session.send', 'write failed');
    await rejection;
  });
});
