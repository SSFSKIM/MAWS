// Lane A behind the controls port (P5 O9 M5, Interfaces §C and §D): a terminal session driven through its sminos bridge.
// Each control's capability is drawn from the session's capability list, never from its lane; each method reaches its
// `laneA.*` command with the inputs Interfaces §A gives and maps the answer into the port's (lane B's) types.
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequestAnswer } from '@shared/engine/answers';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { LaneARaised, LaneAState } from '@shared/ipc/schema/lane-a';
import { item, record, T0 } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { EMPTY_CATALOG } from '../../stores/catalog';
import { applyLaneAState, resetLaneAStore, useLaneA } from '../../stores/lane-a';
import { laneACatalog, laneAState } from '../../lane-a/test-support/lane-a-state';
import { resetLaneAWatches } from '../../lane-a/watches';
import { laneAAnswerCapability, laneAControls, LANE_A_WORDS } from './lane-a';

const APP = at('app-a') as AppSessionId;
const terminal = { kind: 'terminal', pid: 4242 } as const;
const rec = record(APP, { holder: terminal, directory: '/work/here' });

beforeEach(() => {
  resetLaneAStore();
  resetLaneAWatches();
});

function port(over: Partial<LaneAState> = {}, given: Parameters<typeof fakeClient>[0] = {}) {
  const state = laneAState(APP, over);
  applyLaneAState(APP, state);
  useLaneA.setState((s) => ({ catalogs: new Map(s.catalogs).set(APP, laneACatalog()) }));
  const fake = fakeClient({ 'laneA.catalog': laneACatalog(), ...given });
  return { fake, controls: laneAControls(state, rec, { appSessionId: APP, client: fake.client }) };
}

describe('capability', () => {
  it('draws the conversation verbs from the bridge’s ops and the turn, and the rest from its controls', () => {
    const { controls } = port();
    expect(controls.capability('send')).toEqual({ available: true });
    expect(controls.capability('command')).toEqual({ available: true });
    expect(controls.capability('stop-task')).toEqual({ available: true });
    expect(controls.capability('answer')).toEqual({ available: true });
    expect(controls.capability('interrupt')).toEqual({ available: false, reason: LANE_A_WORDS.idle }); // nothing runs
    expect(port({ turn: { running: true, unknown: false } }).controls.capability('interrupt')).toEqual({ available: true });
    expect(controls.capability('model')).toEqual({ available: true });
    expect(controls.capability('btw')).toEqual({ available: true });
    expect(controls.capability('stop-agent')).toEqual({ available: true });
    expect(controls.capability('tell')).toEqual({ available: true });
    expect(controls.capability('mcp.enable')).toEqual({ available: true });
    expect(controls.capability('mcp.reconnect')).toEqual({ available: true });
    expect(controls.capability('subagent-rows')).toEqual({ available: true });
    expect(controls.capability('take-over')).toEqual({ available: true });
  });

  it('names why each gap is closed, none hidden', () => {
    const { controls } = port();
    expect(controls.capability('mode')).toEqual({ available: false, reason: LANE_A_WORDS.mode });
    expect(controls.capability('queue')).toEqual({ available: false, reason: LANE_A_WORDS.queue });
    expect(controls.capability('rewind')).toEqual({ available: false, reason: LANE_A_WORDS.rewind });
    expect(controls.capability('decide.interrupt')).toEqual({ available: false, reason: 'Deny-and-interrupt is answered in the terminal' });
    expect(controls.capability('forget')).toEqual({ available: false, reason: 'Forget runs in the terminal' });
    expect(controls.capability('rewind-files')).toEqual({ available: false, reason: 'File rollback runs in the terminal' });
    expect(controls.capability('elicitation.answer')).toEqual({ available: false, reason: LANE_A_WORDS.elicitation });
    expect(controls.capability('mcp.disable')).toEqual({ available: false, reason: 'The route table drops /mcp disable on this engine' });
    expect(controls.capability('reopen')).toMatchObject({ available: false });
  });

  it('reads a control a sminos does not name as not in that version, and an op it lacks as not in this sminos', () => {
    const { controls } = port({ controls: {}, ops: ['deliver'] });
    expect(controls.capability('btw')).toEqual({ available: false, reason: 'Not in sminos 1.25.0' });
    expect(controls.capability('command')).toEqual({ available: false, reason: 'Not in this session’s sminos (1.25.0)' });
  });

  it('closes MCP’s verbs when the catalog’s /mcp route does not run them', () => {
    const { controls } = port();
    useLaneA.setState((s) => ({ catalogs: new Map(s.catalogs).set(APP, laneACatalog({ commands: [] })) }));
    expect(controls.capability('mcp.enable')).toMatchObject({ available: false });
  });
});

describe('send', () => {
  it('delivers plain words in either turn state and reads their entry as sent or steered', async () => {
    const { fake, controls } = port({}, { 'laneA.send': { key: { writer: 'maws/m', seq: 1 }, state: 'entered', uuid: 'row-1' } });
    expect(await controls.send('hello there', { origin: 'composer' })).toEqual({ disposition: 'sent', started: false, messageUuid: 'row-1' });
    expect(fake.invoked('laneA.send')).toEqual([{ appSessionId: APP, text: 'hello there' }]);
    const busy = port({ turn: { running: true, unknown: false } }, { 'laneA.send': { key: { writer: 'maws/m', seq: 2 }, state: 'entered', uuid: 'row-2' } });
    expect(await busy.controls.send([{ type: 'text', text: 'and' }, { type: 'text', text: 'more' }], { origin: 'composer' })).toMatchObject({ disposition: 'steered' });
    expect(busy.fake.invoked('laneA.send')).toEqual([{ appSessionId: APP, text: 'and\nmore' }]);
  });

  it('keeps a refusal’s reason, and hands a send whose fate is not known yet to the strip', async () => {
    const refused = port({}, { 'laneA.send': { key: null, state: 'refused', reason: 'too many messages waiting for this session', code: 'busy' } });
    expect(await refused.controls.send('x', { origin: 'composer' })).toEqual({ disposition: 'refused', started: false, reason: 'too many messages waiting for this session' });
    const key = { writer: 'maws/m', seq: 3 };
    const later = port({}, { 'laneA.send': { key, state: 'submitted' } });
    expect(await later.controls.send('slow words', { origin: 'composer' })).toEqual({ disposition: 'unconfirmed', started: false });
    expect(useLaneA.getState().pendingSends.get(APP)).toEqual([{ key, text: 'slow words', state: 'sending', reason: null }]);
  });

  it('runs a `/` text whose route runs as a command, and refuses one whose route does not, sending nothing', async () => {
    const { fake, controls } = port({}, { 'laneA.command': { state: 'done', result: { queued: true, id: 'cmd-1' } } });
    expect(await controls.send('/rename o9-sitting', { origin: 'composer' })).toEqual({ disposition: 'sent', started: false });
    expect(fake.invoked('laneA.command')).toEqual([{ appSessionId: APP, name: 'rename', args: 'o9-sitting' }]);
    expect(await controls.send('/config', { origin: 'composer' })).toMatchObject({ disposition: 'refused', reason: expect.stringContaining('opens a panel in the terminal') });
    expect(await controls.send('/doctor', { origin: 'composer' })).toEqual({ disposition: 'refused', started: false, reason: 'runs only in the terminal' });
    expect(fake.invoked('laneA.command')).toHaveLength(1);
    expect(fake.invoked('laneA.send')).toEqual([]);
  });

  it('refuses an attachment, and honours the caller’s own checks', async () => {
    const { fake, controls } = port();
    expect(await controls.send([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }, { type: 'text', text: 'look' }] as never, { origin: 'composer' })).toMatchObject({ disposition: 'refused', reason: LANE_A_WORDS.attachments });
    expect(await controls.send('x', { origin: 'composer', precheck: () => false })).toEqual({ disposition: 'refused', started: false });
    expect(fake.calls.filter((c) => c.startsWith('invoke laneA.send'))).toEqual([]);
  });
});

describe('the other controls', () => {
  it('interrupts for Stop and Esc alike, the queue flags ignored', async () => {
    const { fake, controls } = port({ turn: { running: true, unknown: false } }, { 'laneA.interrupt': { state: 'done', result: {} } });
    expect(await controls.interrupt({ cancelEngineQueued: false, holdEngineQueued: true })).toEqual({ ok: true, value: { stillQueued: [], cancelled: [] } });
    expect(await controls.interrupt({ cancelEngineQueued: false })).toMatchObject({ ok: true });
    expect(fake.invoked('laneA.interrupt')).toEqual([{ appSessionId: APP }, { appSessionId: APP }]);
  });

  it('maps a refusal and an unknown outcome into the port’s error shape, never a new code', async () => {
    const refused = port({}, { 'laneA.interrupt': { state: 'refused', code: 'no-bridge', message: 'gone' } });
    expect(await refused.controls.interrupt({ cancelEngineQueued: false })).toEqual({ ok: false, error: { code: 'internal', message: 'gone', issues: { refusal: 'no-bridge' } } });
    const unknown = port({}, { 'laneA.btw': { state: 'unknown', why: 'timeout' } });
    expect(await unknown.controls.btw('why?')).toMatchObject({ ok: false, error: { code: 'internal', issues: { unknown: 'timeout' } } });
  });

  it('asks a side question as an op, a retry asking again', async () => {
    const { fake, controls } = port({}, { 'laneA.btw': { state: 'done', result: { started: true, id: 'cmd-9' } } });
    expect(await controls.btw('why?', { retryOf: 'cmd-1' })).toEqual({ ok: true, value: { opId: 'cmd-9' } });
    expect(fake.invoked('laneA.btw')).toEqual([{ appSessionId: APP, prompt: 'why?' }]);
  });

  it('compacts, runs a command, stops and tells a subagent and stops a background task', async () => {
    const done = { state: 'done', result: {} };
    const { fake, controls } = port({}, { 'laneA.compact': done, 'laneA.command': done, 'laneA.stopAgent': done, 'laneA.tell': done, 'laneA.stopTask': done });
    await controls.compact('keep the file list');
    await controls.compact();
    await controls.command('mcp', 'enable github');
    await controls.stopAgent('agent-1');
    await controls.tell('agent-1', 'wrap up');
    await controls.stopTask('task-7');
    expect(fake.invoked('laneA.compact')).toEqual([{ appSessionId: APP, instructions: 'keep the file list' }, { appSessionId: APP }]);
    expect(fake.invoked('laneA.command')).toEqual([{ appSessionId: APP, name: 'mcp', args: 'enable github' }]);
    expect(fake.invoked('laneA.stopAgent')).toEqual([{ appSessionId: APP, agentId: 'agent-1' }]);
    expect(fake.invoked('laneA.tell')).toEqual([{ appSessionId: APP, agentId: 'agent-1', text: 'wrap up' }]);
    expect(fake.invoked('laneA.stopTask')).toEqual([{ appSessionId: APP, taskId: 'task-7' }]);
  });

  it('has no MAWS queue, and reports its turn as the bridge does', () => {
    expect(port().controls.queue()).toBeNull();
    expect(port({ turn: { running: true, unknown: false } }).controls.turn()).toEqual({ running: true });
  });
});

describe('the chips', () => {
  it('names the override, else the session’s model, and lists the catalog’s models with fable', () => {
    const { controls } = port({ override: { model: 'haiku', effort: 'low' } });
    const model = controls.bindings().model;
    expect(model.label).toBe('haiku low');
    expect(model.value).toEqual({ model: 'haiku', effort: 'low' });
    expect(model.options.map((o) => o.value)).toEqual(['opus', 'sonnet', 'haiku', 'fable']);
    expect(port().controls.bindings().model.label).toBe('opus');
  });

  it('sends only what changed', async () => {
    const { fake, controls } = port({ override: { model: 'haiku', effort: null } }, { 'laneA.model': { state: 'done', result: {} } });
    expect(await controls.bindings().model.set({ model: 'haiku', effort: 'low' })).toEqual({ ok: true });
    expect(await controls.bindings().model.set({ model: 'sonnet', effort: null })).toEqual({ ok: true });
    expect(fake.invoked('laneA.model')).toEqual([{ appSessionId: APP, effort: 'low' }, { appSessionId: APP, model: 'sonnet' }]);
  });

  it('closes the mode and the directories with their reasons', async () => {
    const { bindings } = port().controls;
    expect(bindings().mode.disabled).toBe(LANE_A_WORDS.mode);
    expect(await bindings().mode.set('plan')).toEqual({ ok: false, error: LANE_A_WORDS.mode });
    expect(bindings().directories.disabled).toBe(LANE_A_WORDS.directories);
    expect(bindings().location.path).toBe('/work/here');
  });
});

describe('the palette', () => {
  it('lists the bridge’s catalog with why each command it can’t run is closed, and opens only the widgets lane A backs', () => {
    const { controls } = port();
    const { catalog, widgets } = controls.slash(EMPTY_CATALOG, new Set(['model', 'effort', 'compact', 'mcp', 'btw', 'rename', 'usage', 'rewind']));
    expect(catalog.commands.map((c) => c.name)).toEqual(['rename', 'cost', 'config', 'doctor', 'mcp', 'model', 'compact', 'review']);
    expect([...widgets].sort()).toEqual(['btw', 'compact', 'effort', 'mcp', 'model']);
    expect(catalog.unavailable?.doctor).toBe('runs only in the terminal');
    expect(catalog.unavailable?.config).toContain('opens a panel in the terminal');
    expect(catalog.unavailable?.rename).toBeUndefined();
    expect(catalog.unavailable?.usage).toBe(LANE_A_WORDS.widget);
    expect(catalog.unavailable?.rewind).toBe(LANE_A_WORDS.rewind);
  });
});

describe('answers', () => {
  const raised = (over: Partial<LaneARaised> = {}): LaneARaised => ({ request: 'req-1', session: 'eng-1', tool: 'Bash', input: { command: 'ls' }, ...over });
  const controls = { ...laneAState(APP).controls };
  const can = (r: LaneARaised, answer: RequestAnswer) => laneAAnswerCapability(r, answer, controls);

  it('offers what lane A carries and closes each variant it can’t, with its reason', () => {
    expect(can(raised(), { kind: 'permission', decision: 'allow', scope: 'once' })).toEqual({ available: true });
    expect(can(raised(), { kind: 'permission', decision: 'deny', message: 'no' })).toEqual({ available: true });
    expect(can(raised(), { kind: 'permission', decision: 'deny_and_stop' })).toEqual({ available: false, reason: 'Deny-and-interrupt is answered in the terminal' });
    expect(can(raised(), { kind: 'permission', decision: 'allow', scope: 'once', updatedInput: { command: 'ls -a' } })).toEqual({ available: false, reason: 'An edited input is answered in the terminal' });
    const one = raised({ suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'localSettings' }] });
    expect(can(one, { kind: 'permission', decision: 'allow', scope: 'session' })).toEqual({ available: true });
    expect(can(one, { kind: 'permission', decision: 'allow', scope: 'local_settings' })).toEqual({ available: true });
    const two = raised({ suggestions: [{ type: 'addRules' }, { type: 'addRules' }] });
    expect(can(two, { kind: 'permission', decision: 'allow', scope: 'session' })).toMatchObject({ available: false });
    expect(can(raised({ suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] }), { kind: 'permission', decision: 'allow', scope: 'session' })).toMatchObject({ available: false });
    const ask = raised({ tool: 'AskUserQuestion' });
    expect(can(ask, { kind: 'question', answers: {} })).toEqual({ available: true }); // a native question declined
    expect(can(raised({ tool: 'ask', async: true }), { kind: 'question', answers: {} })).toEqual({ available: false, reason: 'An async question needs an answer' });
    expect(can(raised({ tool: 'ask', async: true }), { kind: 'permission', decision: 'deny' })).toEqual({ available: false, reason: 'An async question is answered, never declined' });
    const plan = raised({ tool: 'ExitPlanMode' });
    expect(can(plan, { kind: 'plan', outcome: 'implement', feedback: null })).toEqual({ available: true });
    expect(can(plan, { kind: 'plan', outcome: 'clear_and_implement', feedback: null })).toEqual({ available: false, reason: '/clear runs in the terminal' });
    expect(can(raised(), { kind: 'elicitation', action: 'accept' })).toEqual({ available: false, reason: LANE_A_WORDS.elicitation });
  });

  it('answers through laneA.answer with the item’s request', async () => {
    const { fake, controls: c } = port({ pending: [raised()] }, { 'laneA.answer': { outcome: 'delivered' } });
    const asked = item(APP, 'permission', T0, { request: { requestId: 'req-1' as RequestId, toolUseId: null, taskId: null, agentId: null } });
    expect(await c.answer(asked, { kind: 'permission', decision: 'allow', scope: 'once' })).toEqual({ ok: true, value: { outcome: 'delivered' } });
    expect(fake.invoked('laneA.answer')).toEqual([{ appSessionId: APP, request: 'req-1', answer: { kind: 'permission', decision: 'allow', scope: 'once' } }]);
  });
});
