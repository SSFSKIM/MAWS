// Which implementation of the controls port a session gets (P5 O9 M4): lane B for a session MAWS holds or nobody
// holds (a contested one included); for a session a terminal or a background job holds, lane A while its bridge is live
// (M5), none otherwise, which stays read-only.
import { act, render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { addressOf } from '@shared/machine/address';
import { item, record, remoteRow, status, T0 } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { useMachines } from '../../stores/machines';
import { applyLaneAState, resetLaneAStore, useLaneA } from '../../stores/lane-a';
import { resetQueueStore } from '../../stores/queue';
import { laneACatalog, laneAState } from '../../lane-a/test-support/lane-a-state';
import { useSessions } from '../../stores/sessions';
import { applyRemoteSession, resetRemoteLaneBStore } from '../../lane-b/remote-session';
import { ALL_OPEN, remoteSessionState } from '../../lane-b/test-support/remote-session';
import { answerSession, askSession, compactSession, controlsFor, drivenByBridge, screenshotRoom, sendToSession, sessionControls, stopSessionTask, useSessionControls } from './controls-for';
import { FILES_MAX, LANE_A_WORDS } from './lane-a'; // UX wave U5a
import { READER } from '../../sessions/share/copy'; // board 525
import { readerGradeOf, resetReader, useReader } from '../../sessions/share/reader'; // board 525

const APP = 'app-c' as AppSessionId;
const UUID = '22222222-2222-4222-8222-222222222222' as MessageUuid;
const terminal = { kind: 'terminal', pid: 4242 } as const;
const job = { kind: 'background_job', pid: null, jobId: 'job-1' } as const;

beforeEach(() => {
  resetQueueStore();
  resetLaneAStore();
  useSessions.setState({ engine: new Map(), digests: new Map(), records: new Map(), listed: new Map() });
});

const inputs = () => ({ appSessionId: APP, client: fakeClient().client });

describe('controlsFor', () => {
  it.each<[string, SessionRecord['holder']]>([
    ['held by MAWS', { kind: 'self' }],
    ['held by MAWS and contested by a terminal', { kind: 'self', contestedBy: terminal }],
    ['held by nobody', { kind: 'none' }],
  ])('gives a session %s lane B', (_name, holder) => {
    const controls = controlsFor(record(APP, { holder }), null, inputs());
    expect(controls).not.toBeNull();
    expect(controls!.queue()).not.toBeNull();
    expect(controls!.capability('command')).toMatchObject({ available: false });
  });

  it('gives a session with no record lane B (an id the seam still sends to by its status)', () => {
    expect(controlsFor(null, null, inputs())).not.toBeNull();
  });

  it.each<[string, SessionRecord['holder']]>([
    ['a terminal', terminal],
    ['a background job', job],
  ])('gives a session held by %s no port: it stays read-only', (_name, holder) => {
    expect(controlsFor(record(APP, { holder }), null, inputs())).toBeNull();
  });

  it('gives a session held elsewhere lane A while its bridge is live, and none while it starts or can’t be driven (M5)', () => {
    const held = record(APP, { holder: terminal });
    const live = controlsFor(held, laneAState(APP), inputs());
    expect(live).not.toBeNull();
    expect(live!.queue()).toBeNull();
    expect(live!.capability('command')).toEqual({ available: true });
    expect(controlsFor(held, laneAState(APP, { bridge: 'starting', reason: 'the session’s bridge is starting' }), inputs())).toBeNull();
    expect(controlsFor(held, laneAState(APP, { bridge: 'none', reason: 'update sminos' }), inputs())).toBeNull();
    expect(controlsFor(record(APP), laneAState(APP), inputs())!.queue(), 'a session MAWS holds stays lane B').not.toBeNull();
  });

  // P5 O9 M9: another machine's terminal session is a listed row of lane A (O8's R1, R2), with no record.
  it('gives another machine’s listed lane A row lane A’s port, starting until its watch’s first state; a lane B row stays lane B', () => {
    const remote = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
    const laneB = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: T0, generation: 0 }]);
    useSessions.setState({ listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A', availability: 'foreign_held' }), appId: remote }], [laneB, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: laneB }]]) });
    const client = fakeClient().client;
    const starting = controlsFor(null, null, { appSessionId: remote, client })!;
    expect(starting.queue()).toBeNull();
    expect(starting.capability('send')).toEqual({ available: false, reason: 'Reading the session from Studio' });
    expect(starting.capability('take-over')).toMatchObject({ available: false }); // a remote gap
    const live = controlsFor(null, laneAState(remote, { link: { state: 'up', refusal: null, carrier: 'direct', member: 'm', clientClass: 'native-mac', rights: [], reason: null }, acts: [] }), { appSessionId: remote, client })!;
    expect(live.capability('send')).toEqual({ available: true });
    expect(live.capability('stop-task')).toMatchObject({ available: false });
    expect(controlsFor(null, null, { appSessionId: laneB, client })!.queue(), 'a remote lane B row').not.toBeNull();
    expect(drivenByBridge(remote)).toBe(true);
    expect(drivenByBridge(laneB)).toBe(false);
  });
});

// P5 O7 M2: another machine's lane B session (a record main read over its link) takes lane B's port with main's overlay.
describe('a lane B session on another machine', () => {
  const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
  const rewindGap = { available: false as const, reason: 'rewinding a session on another machine waits for its files panel' };
  beforeEach(() => {
    resetRemoteLaneBStore();
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: T0, generation: 0, carrier: 'relay' }]);
    useSessions.setState({ records: new Map([[REMOTE, record(REMOTE)]]), listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: REMOTE }]]), listedMachines: new Set([OTHER_MACHINE]) });
  });

  it('gets lane B’s port with the overlay main says for it', () => {
    applyRemoteSession(remoteSessionState(REMOTE, { controls: { ...ALL_OPEN, rewind: rewindGap } }));
    const port = sessionControls(REMOTE, fakeClient().client)!;
    expect(port.queue()).not.toBeNull();
    expect(port.capability('rewind')).toEqual(rewindGap);
    expect(port.capability('send')).toEqual({ available: true }); // a record is enough: an idle session is resumed by its send
  });

  it('renders again when main says the session’s state again', () => {
    applyRemoteSession(remoteSessionState(REMOTE));
    const { result } = renderHook(() => useSessionControls(REMOTE, { client: fakeClient().client })?.capability('rewind'));
    expect(result.current).toEqual({ available: true });
    act(() => applyRemoteSession(remoteSessionState(REMOTE, { controls: { ...ALL_OPEN, rewind: rewindGap } })));
    expect(result.current).toEqual(rewindGap);
  });
});

// Board 525: another member's session refuses a send below Converse at the member's grade; the refusal says so with whom
// to ask, never nothing, and from then on the port is closed in those words, a send refused without going. An owner's
// session learns nothing from it.
describe('a session the member can read but not talk to', () => {
  const ANA = { id: 'member-ana', email: 'ana@example.test', name: 'Ana' };
  const LANE_A = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
  const LANE_B = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
  const live = laneAState(LANE_A, { link: { state: 'up', refusal: null, carrier: 'direct', member: 'member-me', clientClass: 'native-mac', rights: [], reason: null }, acts: [] });
  const listed = (mine: boolean) =>
    useSessions.setState({
      records: new Map([[LANE_B, record(LANE_B)]]),
      listed: new Map([
        [LANE_A, { ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A', availability: 'foreign_held', owners: [mine ? 'member-me' : ANA.id], mine }), appId: LANE_A }],
        [LANE_B, { ...remoteRow(OTHER_MACHINE, 'app-r', { owners: [mine ? 'member-me' : ANA.id], mine }), appId: LANE_B }],
      ]),
      listedMachines: new Set([OTHER_MACHINE]),
      members: new Map([[ANA.id, ANA]]),
      member: 'member-me',
    });
  const gradeRefused = { key: null, state: 'refused', reason: 'you can’t do that on this session', code: 'grade' };
  beforeEach(() => {
    resetReader();
    resetRemoteLaneBStore();
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: T0, generation: 0, carrier: 'relay' }]);
  });

  it('lane A: says the refused send with whom to ask for Converse, then closes every control but a subagent’s rows and sends nothing more', async () => {
    listed(false);
    const fake = fakeClient({ 'laneA.send': gradeRefused });
    const port = controlsFor(null, live, { appSessionId: LANE_A, client: fake.client })!;
    expect(port.capability('send')).toEqual({ available: true }); // nothing says the grade before a send
    expect(await port.send('hello', { origin: 'composer' })).toEqual({ disposition: 'refused', started: false, reason: READER.notSent('Ana') });
    expect(readerGradeOf(LANE_A)).toBe('view');
    const closed = controlsFor(null, live, { appSessionId: LANE_A, client: fake.client })!;
    const words = { available: false, reason: READER.cantTalk('Ana') };
    expect(closed.capability('send')).toEqual(words);
    expect(closed.capability('interrupt')).toEqual(words);
    expect(closed.capability('model')).toEqual(words);
    expect(closed.capability('subagent-rows')).toEqual(port.capability('subagent-rows'));
    expect(await closed.send('again', { origin: 'composer' })).toEqual({ disposition: 'refused', started: false, reason: READER.cantTalk('Ana') });
    expect(fake.invoked('laneA.send')).toHaveLength(1);
  });

  it('lane B: says the machine’s `grade` refusal of a send with whom to ask, and learns it', async () => {
    listed(false);
    applyRemoteSession(remoteSessionState(LANE_B));
    const fake = fakeClient();
    const port = controlsFor(record(LANE_B), null, { appSessionId: LANE_B, client: fake.client })!;
    const sent = port.send('hello', { origin: 'composer' });
    await fake.fail('session.send', 'session.send: refused grade by machine mini', 'internal', { refusal: 'grade' });
    expect(await sent).toEqual({ disposition: 'refused', started: false, reason: READER.notSent('Ana') });
    expect(readerGradeOf(LANE_B)).toBe('view');
  });

  // The endpoint grades a message by its text: a leading `/` is Manage but for a few commands, so a refusal of such words
  // says nothing of Converse. Plain words refused `grade` are what teach View.
  it.each<[string, string | object[]]>([
    ['a slash command', '/compact'],
    ['a custom command after leading space', '  /deploy now'],
    ['a text block that starts with one', [{ type: 'text', text: 'see this' }, { type: 'text', text: '/compact' }]],
  ])('lane B: learns nothing from a `grade` refusal of %s, and main’s words show', async (_name, content) => {
    listed(false);
    applyRemoteSession(remoteSessionState(LANE_B));
    const fake = fakeClient();
    const port = controlsFor(record(LANE_B), null, { appSessionId: LANE_B, client: fake.client })!;
    const sent = port.send(content as string, { origin: 'composer' });
    const settled = expect(sent).rejects.toThrow('refused grade by machine mini');
    await fake.fail('session.send', 'session.send: refused grade by machine mini', 'internal', { refusal: 'grade' });
    await settled;
    expect(readerGradeOf(LANE_B)).toBeNull();
  });

  it('lane B: learns View from a `grade` refusal of content whose text blocks are plain words', async () => {
    listed(false);
    applyRemoteSession(remoteSessionState(LANE_B));
    const fake = fakeClient();
    const port = controlsFor(record(LANE_B), null, { appSessionId: LANE_B, client: fake.client })!;
    const sent = port.send([{ type: 'text', text: 'hello /not-a-command' }], { origin: 'composer' });
    await fake.fail('session.send', 'session.send: refused grade by machine mini', 'internal', { refusal: 'grade' });
    expect(await sent).toMatchObject({ disposition: 'refused' });
    expect(readerGradeOf(LANE_B)).toBe('view');
  });

  // Every send goes through a port, whoever calls it (a quick reply, a card's thread, an answering), so the port keeps
  // what the host took as the member's own: by uuid, or, queued, by queue id.
  it('keeps a send the host took for another member’s session as the member’s own, through the seam outside the composer', async () => {
    listed(false);
    applyRemoteSession(remoteSessionState(LANE_B));
    const fake = fakeClient({ 'session.send': { disposition: 'sent', messageUuid: UUID } });
    expect(await sendToSession(LANE_B, 'hi', { origin: 'reply' }, fake.client)).toMatchObject({ disposition: 'sent' });
    expect(useReader.getState().sent.get(LANE_B)).toEqual(new Set([UUID]));
  });

  it('keeps a queued send by its queue id, and a refused one not at all', async () => {
    listed(false);
    applyRemoteSession(remoteSessionState(LANE_B));
    expect(await sendToSession(LANE_B, 'hi', { origin: 'reply' }, fakeClient({ 'session.send': { disposition: 'queued', queueId: 'q-1' } }).client)).toMatchObject({ disposition: 'queued' });
    expect(useReader.getState().queued.get(LANE_B)).toEqual(new Set(['q-1']));
    resetReader();
    const refused = fakeClient();
    const sent = sendToSession(LANE_B, 'hi', { origin: 'reply' }, refused.client);
    const settled = expect(sent).rejects.toThrow('nope');
    await refused.fail('session.send', 'nope');
    await settled;
    expect(useReader.getState().sent.size + useReader.getState().queued.size).toBe(0);
  });

  it('keeps nothing of a send to the member’s own session', async () => {
    listed(true);
    applyRemoteSession(remoteSessionState(LANE_B));
    await sendToSession(LANE_B, 'hi', { origin: 'reply' }, fakeClient({ 'session.send': { disposition: 'sent', messageUuid: UUID } }).client);
    expect(useReader.getState().sent.size).toBe(0);
  });

  it('learns nothing on the member’s own session: main’s words stand', async () => {
    listed(true);
    const port = controlsFor(null, live, { appSessionId: LANE_A, client: fakeClient({ 'laneA.send': gradeRefused }).client })!;
    expect(await port.send('hello', { origin: 'composer' })).toEqual({ disposition: 'refused', started: false, reason: 'you can’t do that on this session' });
    expect(readerGradeOf(LANE_A)).toBeNull();
  });
});

describe('useSessionControls', () => {
  // 2026-11-06 (e2e:remote's lane B scene caught it): the hook reads the session's machine's capabilities (a remote
  // terminal session's `subagent-rows`), and a session id that is no address (a status-only session, a tab's own id)
  // names no machine: it reads none, as before, and never throws
  it('reads no machine for a session id that is no address', () => {
    const { result } = renderHook(() => useSessionControls('not-an-address' as AppSessionId, { client: fakeClient().client }));
    expect(result.current).not.toBeUndefined();
  });

  // The lane A port reads the session's catalog body when asked (the model chip, the palette, MCP's capabilities), so
  // the hook follows that body as well as the record and the state.
  it('renders again when a bridged session’s catalog arrives, with the catalog’s models', () => {
    useSessions.setState({ records: new Map([[APP, record(APP, { holder: terminal })]]) });
    applyLaneAState(APP, laneAState(APP));
    const { client } = fakeClient({ 'laneA.catalog': null });
    const { result } = renderHook(() => useSessionControls(APP, { client })?.bindings().model.options.map((o) => o.value));
    expect(result.current).toEqual(['fable']); // no catalog yet
    act(() => useLaneA.setState((s) => ({ catalogs: new Map(s.catalogs).set(APP, laneACatalog()) })));
    expect(result.current).toEqual(['opus', 'sonnet', 'haiku', 'fable']);
  });

  // As a component reads it (the composer's chips), which the React Compiler memoizes on the port it was handed.
  it('hands a component a port that names the catalog’s models once it arrives', () => {
    useSessions.setState({ records: new Map([[APP, record(APP, { holder: terminal })]]) });
    applyLaneAState(APP, laneAState(APP));
    function Models() {
      const controls = useSessionControls(APP);
      return createElement('p', null, controls?.bindings().model.options.map((o) => o.value).join(' '));
    }
    const view = render(createElement(Models));
    expect(view.container.textContent).toBe('fable');
    act(() => useLaneA.setState((s) => ({ catalogs: new Map(s.catalogs).set(APP, laneACatalog()) })));
    expect(view.container.textContent).toBe('opus sonnet haiku fable');
    view.unmount();
  });
});

describe('a caller outside the pane', () => {
  it('reaches the session’s port from the stores', async () => {
    useSessions.setState({ records: new Map([[APP, record(APP)]]) });
    useSessions.getState().applyStatus({ appSessionId: APP, status: status(APP) }, TEST_MACHINE);
    const fake = fakeClient({ 'session.send': { disposition: 'sent', queueId: 'q', messageUuid: UUID }, 'session.queue.list': { entries: [], paused: false } });
    expect(sessionControls(APP, fake.client)).not.toBeNull();
    expect(await sendToSession(APP, 'hi', { origin: 'reply' }, fake.client)).toEqual({ disposition: 'sent', started: false, messageUuid: UUID });
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: APP, content: 'hi' }]);
  });

  it('is refused in the holder’s words, sending nothing, when a terminal holds the session', async () => {
    useSessions.setState({ records: new Map([[APP, record(APP, { holder: terminal })]]) });
    const fake = fakeClient();
    expect(sessionControls(APP, fake.client)).toBeNull();
    expect(await sendToSession(APP, 'hi', { origin: 'reply' }, fake.client)).toEqual({ disposition: 'refused', started: false, reason: 'Held by terminal · 4242' });
    expect(fake.calls).toEqual([]);
  });

  it('sends to a bridged terminal session through lane A (M5)', async () => {
    useSessions.setState({ records: new Map([[APP, record(APP, { holder: terminal })]]) });
    applyLaneAState(APP, laneAState(APP));
    const fake = fakeClient({ 'laneA.send': { key: { writer: 'maws/m', seq: 1 }, state: 'entered', uuid: 'row-1' }, 'laneA.catalog': null });
    expect(await sendToSession(APP, 'hi', { origin: 'reply' }, fake.client)).toEqual({ disposition: 'sent', started: false, messageUuid: 'row-1' });
    expect(fake.invoked('laneA.send')).toEqual([{ appSessionId: APP, text: 'hi' }]);
  });

  it('answers, asks, compacts and stops through the port, each refused in the holder’s words when a job holds the session', async () => {
    const fake = fakeClient({ 'session.answer': { outcome: 'delivered' }, 'session.sideQuestion': { opId: 'op' }, 'session.send': { disposition: 'sent', queueId: 'q', messageUuid: UUID }, 'session.stopTask': undefined });
    const asked = item(APP, 'permission', T0);
    const allow = { kind: 'permission', decision: 'allow', scope: 'once' } as const;
    expect(await answerSession(asked, allow, fake.client)).toEqual({ ok: true, value: { outcome: 'delivered' } });
    expect(await askSession(APP, 'why?', 'side-1', fake.client)).toEqual({ ok: true, value: { opId: 'op' } });
    expect(await compactSession(APP, 'keep it short', fake.client)).toMatchObject({ state: 'done' });
    expect(await stopSessionTask(APP, 'task-1', fake.client)).toEqual({ state: 'done' });
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: APP, question: 'why?', retryOf: 'side-1' }]);
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: APP, content: '/compact keep it short' }]);

    useSessions.setState({ records: new Map([[APP, record(APP, { holder: job })]]) });
    const none = fakeClient();
    const held = 'Held by bg · job-1';
    expect(await answerSession(asked, allow, none.client)).toEqual({ ok: false, error: { code: 'internal', message: held } });
    expect(await askSession(APP, 'why?', undefined, none.client)).toEqual({ ok: false, error: { code: 'internal', message: held } });
    expect(await compactSession(APP, undefined, none.client)).toEqual({ state: 'refused', code: 'held', message: held });
    expect(await stopSessionTask(APP, 'task-1', none.client)).toEqual({ state: 'refused', code: 'held', message: held });
    expect(none.calls).toEqual([]);
  });
});

// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, decision 9): how many screenshots a message
// to the session can carry, and the sentence the composer says when it can't carry more
describe('screenshotRoom', () => {
  it('is unbounded for a session MAWS runs', () => {
    useSessions.setState({ records: new Map([[APP, record(APP)]]) });
    expect(screenshotRoom(APP)).toBeNull();
  });

  it('is the bridge’s four files for a terminal session on this Mac, and none for one on another machine', () => {
    useSessions.setState({ records: new Map([[APP, record(APP, { holder: terminal })]]) });
    applyLaneAState(APP, laneAState(APP));
    expect(FILES_MAX).toBe(4);
    expect(screenshotRoom(APP)).toEqual({ max: 4, reason: LANE_A_WORDS.tooManyFiles });

    const remote = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
    useSessions.setState({ listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A', availability: 'foreign_held' }), appId: remote }]]) });
    applyLaneAState(remote, laneAState(remote, { link: { state: 'up', refusal: null, carrier: 'direct', member: 'm', clientClass: 'native-mac', rights: [], reason: null }, acts: [] }));
    expect(screenshotRoom(remote)).toEqual({ max: 0, reason: LANE_A_WORDS.remoteMedia });
  });
});
