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
import { answerSession, askSession, compactSession, controlsFor, drivenByBridge, sendToSession, sessionControls, stopSessionTask, useSessionControls } from './controls-for';

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

describe('useSessionControls', () => {
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
