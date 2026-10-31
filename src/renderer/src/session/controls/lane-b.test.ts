// Lane B behind the controls port (P5 O9 M4): each control reaches the command today's call site invokes, with
// today's arguments, and answers today's result. The literal inputs below are what each call site built before the port.
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequestAnswer } from '@shared/engine/answers';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Availability } from '@shared/ipc/schema/session';
import { digest, humanTurn, item, record, status, T0 } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { addressOf } from '@shared/machine/address';
import { REMOTE_INLINE_MAX_BYTES, REMOTE_TOO_LARGE_WORDS, type RemoteSession } from '@shared/ipc/schema/remote';
import { resetRemoteLaneBStore, useRemoteLaneB } from '../../lane-b/remote-session';
import { ALL_OPEN, remoteSessionState } from '../../lane-b/test-support/remote-session';
import { liveBindings } from '../../composer/frame/bindings';
import { ARCHIVED, ENDED } from '../../composer/submit/submit-state';
import { resetComposerStore } from '../../stores/composer';
import { resetQueueStore } from '../../stores/queue';
import { useSessions } from '../../stores/sessions';
import { useSetup } from '../../sessions/store';
import { laneBControls } from './lane-b';
import type { ControlKey } from './types';

const APP = 'app-b' as AppSessionId;
const UUID = '11111111-1111-4111-8111-111111111111' as MessageUuid;
const queued: QueueEntry = { queueId: 'q1', appSessionId: APP, content: 'later', createdAt: T0, state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false };

beforeEach(() => {
  resetQueueStore();
  resetComposerStore();
  useSessions.setState({ engine: new Map(), digests: new Map(), records: new Map() });
  useSetup.setState({ cards: new Map() });
});

const ready = (over: Parameters<typeof status>[1] = {}) => useSessions.getState().applyStatus({ appSessionId: APP, status: status(APP, over) }, TEST_MACHINE);
const withRecord = (over: Parameters<typeof record>[1] = {}) => {
  const r = record(APP, over);
  useSessions.setState({ records: new Map([[APP, r]]) });
  return r;
};
const digestOf = (availability: Availability) => useSessions.setState({ digests: new Map([[APP, digest(APP, { availability })]]) });

describe('lane B sends as the human seam does', () => {
  it('sends while idle and steers at the next boundary while a turn runs', async () => {
    ready();
    const fake = fakeClient({ 'session.send': { disposition: 'sent', queueId: 'q2', messageUuid: UUID }, 'session.steer': { messageUuid: UUID }, 'session.queue.list': { entries: [], paused: false } });
    const controls = laneBControls(null, { appSessionId: APP, client: fake.client });
    expect(await controls.send('hello', { origin: 'composer' })).toEqual({ disposition: 'sent', started: false, messageUuid: UUID });
    ready({ turn: humanTurn });
    expect(await controls.send('more', { origin: 'reply' })).toEqual({ disposition: 'steered', started: false, messageUuid: UUID });
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: APP, content: 'hello' }]);
    expect(fake.invoked('session.steer')).toEqual([{ appSessionId: APP, content: 'more', priority: 'next' }]);
  });

  it('answers the host’s queued disposition with its queue id', async () => {
    ready();
    const fake = fakeClient({ 'session.send': { disposition: 'queued', queueId: 'q9' }, 'session.queue.list': { entries: [queued], paused: true } });
    const controls = laneBControls(null, { appSessionId: APP, client: fake.client });
    expect(await controls.send('waits', { origin: 'composer' })).toEqual({ disposition: 'queued', started: false, queueId: 'q9' });
  });

  it('holds a composer message behind a trust card, and refuses another origin’s with the card’s words', async () => {
    withRecord();
    const trust = { status: 'needs_trust', trust: { directory: '/work/app-b', reason: 'untrusted' } };
    const fake = fakeClient({ 'session.acquire': trust });
    const controls = laneBControls(useSessions.getState().records.get(APP)!, { appSessionId: APP, client: fake.client });
    expect(await controls.send('first', { origin: 'composer' })).toEqual({ disposition: 'held', started: false, reason: 'trust' });
    expect(await controls.send('reply', { origin: 'reply' })).toEqual({ disposition: 'refused', started: false, reason: 'Trust this folder in the session to continue' });
    expect(fake.invoked('session.acquire')).toMatchObject([{ appSessionId: APP, reason: 'send' }, { appSessionId: APP, reason: 'send' }]);
    expect(fake.invoked('session.send')).toEqual([]);
  });

  it('refuses a session with no process and no record, as the seam does', async () => {
    useSessions.getState().applyStatus({ appSessionId: APP, status: status(APP, { process: 'exited' }) }, TEST_MACHINE);
    const controls = laneBControls(null, { appSessionId: APP, client: fakeClient().client });
    expect(await controls.send('late', { origin: 'composer' })).toEqual({ disposition: 'refused', started: false, reason: ENDED });
  });
});

describe('lane B interrupts, answers and asks as today', () => {
  it('passes Stop’s held queue and Esc’s plain interrupt through unchanged', async () => {
    const fake = fakeClient({ 'session.interrupt': { stillQueued: [], cancelled: ['x'] } });
    const controls = laneBControls(null, { appSessionId: APP, client: fake.client });
    expect(await controls.interrupt({ cancelEngineQueued: false, holdEngineQueued: true })).toEqual({ ok: true, value: { stillQueued: [], cancelled: ['x'] } });
    await controls.interrupt({ cancelEngineQueued: false });
    expect(fake.invoked('session.interrupt')).toEqual([
      { appSessionId: APP, cancelEngineQueued: false, holdEngineQueued: true },
      { appSessionId: APP, cancelEngineQueued: false },
    ]);
  });

  const answers: [string, 'permission' | 'question' | 'plan' | 'dialog' | 'elicitation', RequestAnswer][] = [
    ['allow once', 'permission', { kind: 'permission', decision: 'allow', scope: 'once' }],
    ['allow for the session', 'permission', { kind: 'permission', decision: 'allow', scope: 'session' }],
    ['allow in local settings', 'permission', { kind: 'permission', decision: 'allow', scope: 'local_settings' }],
    ['allow with an edited input', 'permission', { kind: 'permission', decision: 'allow', scope: 'once', updatedInput: { command: 'ls -a' } }],
    ['deny with a message', 'permission', { kind: 'permission', decision: 'deny', message: 'not that' }],
    ['deny and stop', 'permission', { kind: 'permission', decision: 'deny_and_stop' }],
    ['a question’s answers', 'question', { kind: 'question', answers: { 'Which?': 'A, B' } }],
    ['every question skipped', 'question', { kind: 'question', answers: {} }],
    ['implement a plan', 'plan', { kind: 'plan', outcome: 'implement', feedback: null }],
    ['clear and implement', 'plan', { kind: 'plan', outcome: 'clear_and_implement', feedback: null }],
    ['keep planning with feedback', 'plan', { kind: 'plan', outcome: 'keep_planning', feedback: 'smaller steps' }],
    ['a dialog completed', 'dialog', { kind: 'dialog', behavior: 'completed', result: { ok: 1 } }],
    ['an elicitation accepted', 'elicitation', { kind: 'elicitation', action: 'accept', content: { name: 'x' } }],
  ];
  it.each(answers)('answers %s through session.answer with the item’s request id, and offers it', async (_name, kind, answer) => {
    const fake = fakeClient({ 'session.answer': { outcome: 'delivered' } });
    const controls = laneBControls(null, { appSessionId: APP, client: fake.client });
    const asked = item(APP, kind, T0);
    expect(controls.answerCapability(asked, answer)).toEqual({ available: true });
    expect(await controls.answer(asked, answer)).toEqual({ ok: true, value: { outcome: 'delivered' } });
    expect(fake.invoked('session.answer')).toEqual([{ appSessionId: APP, requestId: `req-${APP}`, answer }]);
  });

  it('passes a failed answer’s error through for the card’s Retry', async () => {
    const fake = fakeClient();
    const controls = laneBControls(null, { appSessionId: APP, client: fake.client });
    const answered = controls.answer(item(APP, 'permission', T0), { kind: 'permission', decision: 'deny' });
    await fake.fail('session.answer', 'the host went away');
    expect(await answered).toMatchObject({ ok: false, error: { message: 'the host went away' } });
  });

  it('asks a side question, and asks a failed one again under its retryOf', async () => {
    const receipt = { opId: 'op-1' };
    const fake = fakeClient({ 'session.sideQuestion': receipt });
    const controls = laneBControls(null, { appSessionId: APP, client: fake.client });
    expect(await controls.btw('why?')).toEqual({ ok: true, value: receipt });
    await controls.btw('why?', { retryOf: 'side-7' });
    expect(fake.invoked('session.sideQuestion')).toEqual([
      { appSessionId: APP, question: 'why?' },
      { appSessionId: APP, question: 'why?', retryOf: 'side-7' },
    ]);
  });
});

describe('lane B’s queue is the host queue’s operations', () => {
  it('promotes now and next, holds, removes, edits and resumes with today’s inputs', async () => {
    const fake = fakeClient({ 'session.queue.promote': { messageUuid: UUID }, 'session.queue.hold': queued, 'session.queue.remove': undefined, 'session.queue.edit': queued, 'session.queue.setPaused': undefined });
    const queue = laneBControls(null, { appSessionId: APP, client: fake.client }).queue()!;
    await queue.promote({ queueId: 'q1', priority: 'now' });
    await queue.promote({ queueId: 'q1', priority: 'next' });
    await queue.hold({ messageUuid: UUID });
    await queue.remove({ queueId: 'q1' });
    await queue.edit({ queueId: 'q1', content: 'edited' });
    expect(await queue.setPaused({ paused: false })).toEqual({ ok: true, value: undefined });
    expect(fake.invoked('session.queue.promote')).toEqual([{ appSessionId: APP, queueId: 'q1', priority: 'now' }, { appSessionId: APP, queueId: 'q1', priority: 'next' }]);
    expect(fake.invoked('session.queue.hold')).toEqual([{ appSessionId: APP, messageUuid: UUID }]);
    expect(fake.invoked('session.queue.remove')).toEqual([{ appSessionId: APP, queueId: 'q1' }]);
    expect(fake.invoked('session.queue.edit')).toEqual([{ appSessionId: APP, queueId: 'q1', content: 'edited' }]);
    expect(fake.invoked('session.queue.setPaused')).toEqual([{ appSessionId: APP, paused: false }]);
  });
});

describe('lane B’s compact and background stop answer as controls', () => {
  it('compacts by today’s /compact send, with or without instructions', async () => {
    const fake = fakeClient({ 'session.send': { disposition: 'sent', queueId: 'q3', messageUuid: UUID } });
    const controls = laneBControls(null, { appSessionId: APP, client: fake.client });
    expect(await controls.compact()).toEqual({ state: 'done', result: { disposition: 'sent', queueId: 'q3', messageUuid: UUID } });
    await controls.compact('keep the file list');
    await controls.compact('');
    expect(fake.invoked('session.send')).toEqual([
      { appSessionId: APP, content: '/compact' },
      { appSessionId: APP, content: '/compact keep the file list' },
      { appSessionId: APP, content: '/compact' },
    ]);
  });

  it('keeps a failed compact’s code and words, a timeout included', async () => {
    const error = { code: 'timeout' as const, message: 'compact unanswered after 10 s' };
    const client = { invoke: async () => ({ ok: false, error }), on: () => () => {} } as unknown as MawsBridge;
    expect(await laneBControls(null, { appSessionId: APP, client }).compact('x')).toEqual({ state: 'refused', code: 'timeout', message: 'compact unanswered after 10 s' });
  });

  it('stops a background task through session.stopTask', async () => {
    const fake = fakeClient({ 'session.stopTask': undefined });
    const controls = laneBControls(null, { appSessionId: APP, client: fake.client });
    expect(await controls.stopTask('task-3')).toEqual({ state: 'done' });
    expect(fake.invoked('session.stopTask')).toEqual([{ appSessionId: APP, taskId: 'task-3' }]);
  });
});

describe('lane B’s chips are today’s live bindings', () => {
  it('binds the model, the mode and the directories exactly as liveBindings does over the same frame', async () => {
    const s = status(APP);
    const r = withRecord();
    const fake = fakeClient({
      'session.setModel': { ok: true, error: null, code: null },
      'session.setEffort': undefined,
      'session.setPermissionMode': { refusal: null, error: null },
      'session.listPermissionRules': { state: { rules: [], workspaceDirectories: ['/held'], originalCwd: '/work/app-b', managedOnly: false } },
      'session.applyFlagSettings': undefined,
    });
    const frame = { status: s, reads: { models: null, directories: ['/held'] }, availability: 'usable' as const };
    const bindings = laneBControls(r, { appSessionId: APP, client: fake.client, frame }).bindings();
    const today = liveBindings(s, r, frame.reads, fake.client, 'usable');
    expect(JSON.stringify(bindings)).toEqual(JSON.stringify(today));
    await bindings.model.set({ model: 'claude-sonnet', effort: 'high' });
    await bindings.mode.set('plan');
    await bindings.directories.set(['/held', '/extra']);
    expect(fake.invoked('session.setModel')).toEqual([{ appSessionId: APP, model: 'claude-sonnet' }]);
    expect(fake.invoked('session.setEffort')).toEqual([{ appSessionId: APP, effort: 'high' }]);
    expect(fake.invoked('session.setPermissionMode')).toEqual([{ appSessionId: APP, mode: 'plan' }]);
    expect(fake.invoked('session.applyFlagSettings')).toEqual([{ appSessionId: APP, settings: { permissions: { additionalDirectories: ['/held', '/extra'] } } }]);
  });

  it('reads the session from the stores when no frame is given, and is ended with neither status nor record', () => {
    const bare = laneBControls(null, { appSessionId: APP, client: fakeClient().client }).bindings();
    expect(bare.model.disabled).toBe(ENDED);
    const r = withRecord({ archived: true });
    digestOf('archived');
    const archived = laneBControls(r, { appSessionId: APP, client: fakeClient().client }).bindings();
    expect([archived.model.disabled, archived.directories.disabled]).toEqual([ARCHIVED, ARCHIVED]);
  });
});

describe('lane B’s capabilities are today’s gates', () => {
  const all: ControlKey[] = [
    'send', 'interrupt', 'answer', 'decide', 'decide.scope', 'decide.interrupt', 'decide.addDirectory', 'model', 'mode', 'command', 'btw', 'compact',
    'mcp.enable', 'mcp.disable', 'mcp.reconnect', 'stop-agent', 'tell', 'stop-task', 'media', 'queue', 'rewind', 'forget', 'rewind-files',
    'elicitation.answer', 'subagent-rows', 'take-over', 'reopen',
  ];
  const laneAOnly: ControlKey[] = ['command', 'stop-agent', 'tell', 'take-over'];
  const unavailable = (controls: ReturnType<typeof laneBControls>) => all.filter((key) => !controls.capability(key).available);

  it('offers every control of a ready session but the lane A verbs, each of those with its reason', () => {
    ready();
    const controls = laneBControls(withRecord(), { appSessionId: APP, client: fakeClient().client });
    expect(unavailable(controls)).toEqual(laneAOnly);
    for (const key of laneAOnly) expect(controls.capability(key)).toMatchObject({ available: false, reason: expect.any(String) });
  });

  it('offers a resumable session’s writes (they start it), but no interrupt or stop until a process is ready', () => {
    const controls = laneBControls(withRecord(), { appSessionId: APP, client: fakeClient().client });
    expect(controls.capability('send')).toEqual({ available: true });
    expect(controls.capability('interrupt')).toEqual({ available: false, reason: ENDED });
    expect(controls.capability('stop-task')).toEqual({ available: false, reason: ENDED });
  });

  it('refuses an archived session’s writes with the archive’s words, and still lets its requests be answered', () => {
    const r = withRecord({ archived: true });
    digestOf('archived');
    const controls = laneBControls(r, { appSessionId: APP, client: fakeClient().client });
    expect(controls.capability('send')).toEqual({ available: false, reason: ARCHIVED });
    expect(controls.capability('model')).toEqual({ available: false, reason: ARCHIVED });
    expect(controls.capability('answer')).toEqual({ available: true });
  });
});

// P5 O7 M2: a lane B session on another machine, driven over main's remote lane B adapter. The port is lane B's own, with
// main's overlay (`remote.session`'s controls) closing what the session there can't take, the channel's image bound
// checked before anything is sent, and the send counted while it is on its way ("Sending to <machine>…").
describe('lane B on another machine', () => {
  const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
  const remoteInputs = (client: MawsBridge, state: RemoteSession | null = remoteSessionState(REMOTE)) => ({ appSessionId: REMOTE, client, remote: { state } });
  const remoteRecord = () => useSessions.setState({ records: new Map([[REMOTE, record(REMOTE)]]) });
  beforeEach(() => resetRemoteLaneBStore());

  it('closes with main’s reasons what the overlay closes, and keeps lane B’s own answers for the rest', () => {
    remoteRecord(); // idle: a record and no status; sends resume it
    const controls = { ...ALL_OPEN, rewind: { available: false as const, reason: 'rewinding a session on another machine waits for its files panel' } };
    const port = laneBControls(record(REMOTE), remoteInputs(fakeClient().client, remoteSessionState(REMOTE, { controls })));
    expect(port.capability('rewind')).toEqual({ available: false, reason: 'rewinding a session on another machine waits for its files panel' });
    expect(port.capability('send')).toEqual({ available: true });
    expect(port.capability('interrupt')).toEqual({ available: false, reason: ENDED }); // lane B's own: no process to interrupt
    expect(port.capability('command')).toMatchObject({ available: false }); // lane B's own words where main opens it
  });

  it('closes every control with the reason main says, the answers to cards included', () => {
    remoteRecord();
    const reason = 'This Mac is no longer allowed on mini';
    const closed = Object.fromEntries(Object.keys(ALL_OPEN).map((key) => [key, { available: false, reason }]));
    const port = laneBControls(record(REMOTE), remoteInputs(fakeClient().client, remoteSessionState(REMOTE, { controls: closed as never, reason })));
    expect(port.capability('send')).toEqual({ available: false, reason });
    expect(port.answerCapability(item(REMOTE, 'permission', T0), { kind: 'permission', decision: 'deny' })).toEqual({ available: false, reason });
  });

  it('refuses a send the overlay closes, with its reason, sending nothing', async () => {
    remoteRecord();
    const reason = 'the link to mini closed';
    const closed = { ...ALL_OPEN, send: { available: false as const, reason } };
    const fake = fakeClient();
    const port = laneBControls(record(REMOTE), remoteInputs(fake.client, remoteSessionState(REMOTE, { controls: closed, reason })));
    expect(await port.send('hello', { origin: 'composer' })).toEqual({ disposition: 'refused', started: false, reason });
    expect(fake.calls.filter((call) => call.startsWith('invoke'))).toEqual([]);
  });

  it('sends an image that fits the channel inline, and refuses a larger one before anything is sent, in the composer’s words', async () => {
    useSessions.getState().applyStatus({ appSessionId: REMOTE, status: status(REMOTE) }, OTHER_MACHINE);
    const fake = fakeClient({ 'session.send': { disposition: 'sent', queueId: 'q1', messageUuid: UUID }, 'session.queue.list': { entries: [], paused: false } });
    const port = laneBControls(record(REMOTE), remoteInputs(fake.client));
    const image = (bytes: number) => [{ type: 'text' as const, text: 'look' }, { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'A'.repeat(bytes) } }];
    expect(await port.send(image(2 * 1024 * 1024), { origin: 'composer' })).toMatchObject({ disposition: 'sent' });
    expect(await port.send(image(REMOTE_INLINE_MAX_BYTES), { origin: 'composer' })).toEqual({ disposition: 'refused', started: false, reason: REMOTE_TOO_LARGE_WORDS });
    expect(fake.invoked('session.send')).toHaveLength(1);
  });

  it('counts a send while it is on its way, and stops counting at its answer or its error', async () => {
    useSessions.getState().applyStatus({ appSessionId: REMOTE, status: status(REMOTE) }, OTHER_MACHINE);
    const fake = fakeClient({ 'session.queue.list': { entries: [], paused: false } });
    const port = laneBControls(record(REMOTE), remoteInputs(fake.client));
    const sent = port.send('hello', { origin: 'composer' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useRemoteLaneB.getState().sending.get(REMOTE)).toBe(1);
    await fake.reply('session.send', { disposition: 'sent', queueId: 'q1', messageUuid: UUID });
    await sent;
    expect(useRemoteLaneB.getState().sending.has(REMOTE)).toBe(false);
    const failed = port.send('again', { origin: 'composer' }).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fake.fail('session.send', 'Not sent: mini is offline', 'host_unavailable');
    expect(await failed).toMatchObject({ message: 'Not sent: mini is offline' }); // main's words, which the composer shows with Send again
    expect(useRemoteLaneB.getState().sending.has(REMOTE)).toBe(false);
  });
});
