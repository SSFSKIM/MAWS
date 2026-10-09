import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { QueueEntry } from '@shared/engine/session-state-store';
import { digest, humanTurn, status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { resetComposerStore } from '../../stores/composer';
import { attachQueue, resetQueueStore } from '../../stores/queue';
import { useSessions } from '../../stores/sessions';
import { registerReleasedResume } from '../resume-seam';
import { sendHumanPrompt } from './send-human-prompt';

const APP = 'app-human' as AppSessionId;
const UUID = '11111111-1111-4111-8111-111111111111' as MessageUuid;
const entry: QueueEntry = { queueId: 'q1', appSessionId: APP, content: 'earlier', createdAt: '2026-10-08T00:00:00Z', state: 'submitting', messageUuid: UUID, submittedAt: '2026-10-08T00:00:01Z', uncertain: false, steer: false };
const sendResult = { disposition: 'sent', queueId: 'q2', messageUuid: UUID };
const makeClient = () => fakeClient({ 'session.send': sendResult, 'session.steer': { messageUuid: UUID }, 'session.queue.list': { entries: [], paused: false } });
let offResume = () => {};

beforeEach(() => {
  resetQueueStore();
  resetComposerStore();
  useSessions.setState({ engine: new Map(), digests: new Map() });
});
afterEach(() => {
  offResume();
  resetQueueStore();
});

const ready = (over: Parameters<typeof status>[1] = {}) => useSessions.getState().applyStatus({ appSessionId: APP, status: status(APP, over) });

describe('the human send seam', () => {
  it('sends when idle, returning the host uuid without recording composer history or passing origin to the engine', async () => {
    ready();
    const fake = makeClient();
    expect(await sendHumanPrompt(APP, 'answer', { origin: 'answer' }, fake.client)).toEqual({ disposition: 'sent', messageUuid: UUID });
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: APP, content: 'answer' }]);
    expect(fake.invoked('session.steer')).toEqual([]);
    expect(fake.invoked('session.history.append')).toEqual([]);
  });

  it('steers at the next boundary while a turn runs, never preempting it', async () => {
    ready({ turn: humanTurn });
    const fake = makeClient();
    expect(await sendHumanPrompt(APP, 'reply', { origin: 'reply' }, fake.client)).toEqual({ disposition: 'steered', messageUuid: UUID });
    expect(fake.invoked('session.steer')).toEqual([{ appSessionId: APP, content: 'reply', priority: 'next' }]);
    expect(fake.invoked('session.send')).toEqual([]);
  });

  it('treats a submitting queue entry as busy before the turn starts, including without a mounted composer', async () => {
    ready();
    const fake = fakeClient({ 'session.queue.list': { entries: [entry], paused: false }, 'session.steer': { messageUuid: UUID } });
    expect(await sendHumanPrompt(APP, 'comment', { origin: 'comment' }, fake.client)).toEqual({ disposition: 'steered', messageUuid: UUID });
    expect(fake.invoked('session.steer')).toEqual([{ appSessionId: APP, content: 'comment', priority: 'next' }]);
  });

  it('uses the mounted composer’s event-fed queue rather than reading it again', async () => {
    ready();
    const fake = makeClient();
    const off = attachQueue(APP, fake.client);
    fake.event('session.queue', { appSessionId: APP, entries: [entry], paused: false });
    expect(await sendHumanPrompt(APP, 'peer', { origin: 'peer' }, fake.client)).toEqual({ disposition: 'steered', messageUuid: UUID });
    expect(fake.invoked('session.queue.list')).toHaveLength(1);
    off();
  });

  it('does not invent a uuid for an idle send that joins a paused queue', async () => {
    ready();
    const fake = fakeClient({ 'session.queue.list': { entries: [{ ...entry, state: 'queued', messageUuid: null, submittedAt: null }], paused: true }, 'session.send': { disposition: 'queued', queueId: 'q2', messageUuid: null } });
    expect(await sendHumanPrompt(APP, 'later', { origin: 'composer' }, fake.client)).toEqual({ disposition: 'queued', queueId: 'q2' });
    expect(fake.invoked('session.steer')).toEqual([]);
  });

  it.each(['starting', 'initializing', 'exiting', 'exited'] as const)('refuses a %s process with a reason and writes nothing', async (process) => {
    ready({ process });
    const fake = makeClient();
    expect(await sendHumanPrompt(APP, 'reply', { origin: 'reply' }, fake.client)).toEqual({ disposition: 'refused', reason: process === 'starting' || process === 'initializing' ? 'Session is starting…' : 'Session ended' });
    expect(fake.invoked('session.send')).toEqual([]);
    expect(fake.invoked('session.steer')).toEqual([]);
  });

  it('reads status once when no composer has populated it yet', async () => {
    const fake = fakeClient({ 'session.status': status(APP), 'session.queue.list': { entries: [], paused: false }, 'session.send': sendResult });
    expect(await sendHumanPrompt(APP, 'hello', { origin: 'answer' }, fake.client)).toEqual({ disposition: 'sent', messageUuid: UUID });
    expect(fake.invoked('session.status')).toEqual([{ appSessionId: APP }]);
  });

  it('resumes a released session with the original composer display, answering started without a second send', async () => {
    ready({ process: 'exited' });
    useSessions.getState().applyDigest(digest(APP, { released: { at: '2026-10-08T00:00:00Z', reason: 'budget', limitKiB: 8192 } }));
    const resume = vi.fn(async () => true);
    offResume = registerReleasedResume(resume);
    const content = [{ type: 'text', text: 'carry on' }];
    const fake = makeClient();
    expect(await sendHumanPrompt(APP, content, { origin: 'composer', display: '[Pasted text #1]' }, fake.client)).toEqual({ disposition: 'started' });
    expect(resume).toHaveBeenCalledExactlyOnceWith(APP, { content, display: '[Pasted text #1]' });
    expect(fake.invoked('session.send')).toEqual([]);
    expect(fake.invoked('session.steer')).toEqual([]);
  });

  it('resumes a released session whose status is still absent, without waiting for an engine-status read', async () => {
    useSessions.getState().applyDigest(digest(APP, { released: { at: '2026-10-08T00:00:00Z', reason: 'budget', limitKiB: 8192 } }));
    const resume = vi.fn(async () => true);
    offResume = registerReleasedResume(resume);
    const fake = makeClient();
    const sending = sendHumanPrompt(APP, 'carry on', { origin: 'reply' }, fake.client);
    await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
    expect(await sending).toEqual({ disposition: 'started' });
    expect(fake.invoked('session.status')).toEqual([]);
  });

  it('returns a refusal when released resume is absent or declines the message', async () => {
    ready({ process: 'exited' });
    useSessions.getState().applyDigest(digest(APP, { released: { at: '2026-10-08T00:00:00Z', reason: 'budget', limitKiB: 8192 } }));
    const fake = makeClient();
    expect(await sendHumanPrompt(APP, 'carry on', { origin: 'reply' }, fake.client)).toMatchObject({ disposition: 'refused', reason: expect.any(String) });
    const resume = vi.fn(async () => false);
    offResume = registerReleasedResume(resume);
    expect(await sendHumanPrompt(APP, 'carry on', { origin: 'reply' }, fake.client)).toMatchObject({ disposition: 'refused', reason: expect.any(String) });
    expect(resume).toHaveBeenCalledExactlyOnceWith(APP, { content: 'carry on', display: 'carry on' });
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
