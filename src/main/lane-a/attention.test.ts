// A local terminal session's requests as attention items (P5 O9 M6, "The item"): one per pending `raised`, gone at its
// `settled`, all of them gone when the state stream ends without a fresh snapshot within 5 s or the session leaves lane A;
// and the request view `attention.request` answers for each, which the card reads as it reads a broker item's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionEventSchema } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { LaneARaised, LaneAState } from '@shared/ipc/schema/lane-a';
import { laneAAttention, type LaneAEntry } from './attention';
import type { LaneAView } from './driver';

const APP = 'app-1' as AppSessionId;
const ENGINE = 'e5b1c0de-0000-4000-8000-000000000001';
const T = Date.parse('2026-10-28T10:00:00.000Z');

const state = (pending: LaneARaised[], bridge: LaneAState['bridge'] = 'live'): LaneAState => ({
  appSessionId: APP, engineSessionId: ENGINE, bridge, reason: null, launch: 'launch-1', sminos: '1.25.0', ops: [], reads: [], controls: {},
  turn: { running: true, unknown: false }, model: null, override: null, catalog: null, pending, settled: [], deliveries: [],
});
const view = (pending: LaneARaised[], fresh = true, bridge: LaneAState['bridge'] = 'live'): LaneAView => ({ state: state(pending, bridge), fresh, tool: null });
const raised = (request: string, more: Partial<LaneARaised> = {}): LaneARaised => ({ request, session: ENGINE, tool: 'Bash', input: { command: 'rm -rf build' }, t: T, ...more });

let sets: { appId: AppSessionId; entries: LaneAEntry[] }[];
const last = () => sets.at(-1)?.entries ?? [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T + 5000);
  sets = [];
});
afterEach(() => vi.useRealTimers());

const start = () => laneAAttention({ set: (appId, entries) => sets.push({ appId, entries }) });

describe('lane A attention items', () => {
  it('makes one item per pending request, of the kind the bridge’s own rule names', () => {
    const a = start();
    a.update(APP, view([
      raised('toolu_bash'),
      raised('toolu_ask', { tool: 'AskUserQuestion', input: { questions: [{ question: 'Which colour?', header: 'Colour', options: [{ label: 'Red' }], multiSelect: false }] } }),
      raised('toolu_plugin_q', { tool: 'mcp__plugin_sminos_ask__ask', async: true, input: { questions: [{ question: 'Ship it?', header: 'Ship', options: [] }] }, agentId: 'a1', deadline: '2026-10-28T10:01:00.000Z' }),
      raised('toolu_plan', { tool: 'ExitPlanMode', input: { plan: '1. do it' }, toolUseId: 'toolu_outer' }),
    ]));
    expect(sets).toHaveLength(1);
    expect(sets[0]!.appId).toBe(APP);
    const items = last().map((e) => e.item);
    expect(items.map((i) => [i.id, i.kind, i.summary])).toEqual([
      [`lane-a:${ENGINE}:toolu_bash`, 'permission', 'Bash: rm -rf build'],
      [`lane-a:${ENGINE}:toolu_ask`, 'question', 'Which colour?'],
      [`lane-a:${ENGINE}:toolu_plugin_q`, 'question', 'Ship it?'],
      [`lane-a:${ENGINE}:toolu_plan`, 'plan', 'Plan ready for review'],
    ]);
    expect(items[0]).toEqual({
      id: `lane-a:${ENGINE}:toolu_bash`, appSessionId: APP, sessionId: ENGINE, kind: 'permission',
      request: { requestId: 'toolu_bash', toolUseId: 'toolu_bash', taskId: null, agentId: null },
      summary: 'Bash: rm -rf build', createdAt: '2026-10-28T10:00:00.000Z', state: 'pending', stateChangedAt: '2026-10-28T10:00:00.000Z', expiresAt: null,
    });
    expect(items[2]).toMatchObject({ request: { requestId: 'toolu_plugin_q', toolUseId: 'toolu_plugin_q', agentId: 'a1' }, expiresAt: '2026-10-28T10:01:00.000Z' });
    expect(items[3]!.request.toolUseId).toBe('toolu_outer');
  });

  it('dates a request the bridge stamped no time to when it was first seen, and keeps that date', () => {
    const a = start();
    a.update(APP, view([raised('r1', { t: undefined })]));
    expect(last()[0]!.item.createdAt).toBe(new Date(T + 5000).toISOString());
    vi.setSystemTime(T + 9000);
    a.update(APP, view([raised('r1', { t: undefined }), raised('r2')]));
    expect(last()[0]!.item.createdAt).toBe(new Date(T + 5000).toISOString());
  });

  it('drops a request at its settlement, and tells nothing when nothing changed', () => {
    const a = start();
    a.update(APP, view([raised('r1'), raised('r2')]));
    a.update(APP, view([raised('r1'), raised('r2')]));
    expect(sets).toHaveLength(1);
    a.update(APP, view([raised('r2')]));
    expect(last().map((e) => e.item.request.requestId)).toEqual(['r2']);
  });

  it('keeps the items 5 s after the state stream ends, then drops them unless a fresh snapshot came', () => {
    const a = start();
    a.update(APP, view([raised('r1')]));
    a.update(APP, view([raised('r1')], false));
    vi.advanceTimersByTime(4999);
    expect(last()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(last()).toEqual([]);
    a.update(APP, view([raised('r1')], true)); // the snapshot came after all
    expect(last()).toHaveLength(1);
    a.update(APP, view([raised('r1')], false));
    vi.advanceTimersByTime(3000);
    a.update(APP, view([raised('r1'), raised('r2')], true)); // in time: its snapshot replaces them
    vi.advanceTimersByTime(5000);
    expect(last().map((e) => e.item.request.requestId)).toEqual(['r1', 'r2']);
  });

  it('drops them all at once when the session leaves lane A or its bridge stops being live', () => {
    const a = start();
    a.update(APP, view([raised('r1')]));
    a.update(APP, null);
    expect(last()).toEqual([]);
    a.update(APP, view([raised('r1')]));
    a.update(APP, view([raised('r1')], true, 'none'));
    expect(last()).toEqual([]);
    a.update(APP, view([raised('r1')], false)); // a stale view never brings items back
    expect(last()).toEqual([]);
  });

  it('answers each item’s request as the card reads a broker item’s: a permission, a question, a plan', () => {
    const a = start();
    a.update(APP, view([
      raised('toolu_bash', { suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm -rf build' }], behavior: 'allow', destination: 'localSettings' }], agentId: 'a1' }),
      raised('toolu_ask', { tool: 'AskUserQuestion', input: { questions: [{ question: 'Which colour?', header: 'Colour', options: [{ label: 'Red', description: 'warm' }, { label: 'Blue' }], multiSelect: true }] } }),
      raised('toolu_plan', { tool: 'ExitPlanMode', input: { plan: '1. do it' } }),
    ]));
    const [bash, ask, plan] = last().map((e) => SessionEventSchema.parse(e.request));
    expect(bash).toEqual({
      kind: 'permission.requested', id: `lane-a:${ENGINE}:toolu_bash`, sessionId: ENGINE, at: '2026-10-28T10:00:00.000Z', seq: null, agentId: 'a1', parentToolUseId: null,
      requestId: 'toolu_bash', toolUseId: 'toolu_bash', toolName: 'Bash', displayName: null, input: { command: 'rm -rf build' }, description: null, decisionReasonType: null,
      suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm -rf build' }], behavior: 'allow', destination: 'localSettings' }], blockedPath: null,
    });
    expect(ask).toMatchObject({ kind: 'question.requested', requestId: 'toolu_ask', questions: [{ question: 'Which colour?', header: 'Colour', options: [{ label: 'Red', description: 'warm', preview: null }, { label: 'Blue', description: null, preview: null }], multiSelect: true }] });
    expect(plan).toMatchObject({ kind: 'plan.requested', requestId: 'toolu_plan', plan: '1. do it', input: { plan: '1. do it' } });
  });

  it('stops its timers', () => {
    const a = start();
    a.update(APP, view([raised('r1')]));
    a.update(APP, view([raised('r1')], false));
    a.stop();
    vi.advanceTimersByTime(10_000);
    expect(last()).toHaveLength(1);
  });
});
