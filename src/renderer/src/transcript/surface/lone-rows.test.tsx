// UX wave U2b, M5 (the execution document, §E; R3; reported points 23 and 24): every row the to-human view can fold asks
// a site of its own while it is mounted, so the mod's answer hides or shows it whichever other rows are mounted. Each
// row here is mounted with no other row of its stretch, and answered as the engine answered the probe's lone ask of the
// same row (check 1's C4: u2b-mod-lone-thought, -listing, -notice, -turn): before the first mark (the engine's drawing),
// at the first mark (its invalidation re-asks), at each of the view's two switches, and across a plugin reload, which
// may push nothing (the status's `pluginsObservedAt` re-asks). Then the action row under an answer the mod folds, and a
// browser activity under a call, which follows its call's row and asks nothing of its own. Every text is invented.
import { act, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArrivalEntry } from '@shared/engine/arrival-schema';
import type { RenderAnswer } from '@shared/engine/surface';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { status } from '../../../../../test/support/builders';
import { invalidateSession, resetSurfaceRegistry } from '../../engine-surface/registry';
import { connectEngineSurface } from '../../engine-surface/site';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import type { Row } from '../model/rows';
import { builder, uuid } from '../model/test-events';
import { AnswerActionsStore } from '../view/context';
import { renderRow, storeWith } from '../view/rows/test-support';
import { publishFollows } from './follow';
import { recordedAsks } from './mod-test-support';

type Ask = { component: string; instanceId: string; props: Record<string, unknown> };
const holder = vi.hoisted(() => ({ answer: null as ((name: string, input: unknown) => unknown) | null, calls: [] as { name: string; input: unknown }[] }));
vi.mock('../../ipc/client', () => ({
  ipc: {
    invoke: (name: string, input: unknown) => {
      holder.calls.push({ name, input });
      return Promise.resolve({ ok: true, value: holder.answer!(name, input) });
    },
  },
}));
const ENGINE = (props: Record<string, unknown>): RenderAnswer => ({ tree: { type: 'engine', ref: 1 }, props, rewritten: true, hooked: true });
const EMPTY = (props: Record<string, unknown>): RenderAnswer => ({ tree: { type: 'Box', children: [] }, props, rewritten: false, hooked: true });
let answer: (ask: Ask) => RenderAnswer;
beforeEach(() => {
  resetSurfaceRegistry();
  holder.calls = [];
  answer = (ask) => ENGINE(ask.props);
  holder.answer = (_name, input) => answer(input as Ask);
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map() });
  resetSurfaceRegistry();
});
const asks = () => holder.calls.filter((call) => call.name === 'session.ui.render' || call.name === 'session.ui.renderSite').map((call) => ({ name: call.name, ...(call.input as Ask) }));

// What a person sees of an element: its text outside anything hidden
const hidden = (element: Element) => element instanceof HTMLElement && (element.style.display === 'none' || element.hasAttribute('inert') || element.style.visibility === 'hidden');
function inSight(element: Element): string {
  if (hidden(element)) return '';
  let text = '';
  for (const node of element.childNodes) text += node.nodeType === 3 ? node.textContent : node.nodeType === 1 ? inSight(node as Element) : '';
  return text;
}
// The controls a keyboard can reach, outside anything hidden
const reachable = (root: Element) => [...root.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')].filter((element) => {
  for (let at: Element | null = element; at !== null && at !== root.parentElement; at = at.parentElement) if (hidden(at)) return false;
  return true;
});

async function session(b: ReturnType<typeof builder>) {
  const store = await storeWith(b.events);
  const id = store.key as AppSessionId;
  const attach = (pluginsObservedAt: string) => useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' }, pluginsObservedAt }]]) });
  attach('2026-11-16T10:00:00.000Z');
  // where the mod draws, with the lane off: the session holds a message, so no turn folds
  act(() => useTranscriptStore.getState().setToHumanView(store.key, { lane: false, tailMessage: false, modDraws: true }));
  return { ...store, id, attach };
}
// The bridge's status event, as main sends it, for the connection that re-asks after a reload
function statusBridge() {
  const listeners = new Map<string, (payload: unknown) => void>();
  const bridge = { on: (name: string, listener: (payload: unknown) => void) => { listeners.set(name, listener); return () => listeners.delete(name); } } as unknown as MawsBridge;
  return { bridge, emit: (appSessionId: AppSessionId) => act(() => listeners.get('session.status')?.({ appSessionId, status: useSessions.getState().engine.get(appSessionId) })) };
}
const lone = (name: string) => {
  const recorded = recordedAsks(name).filter((ask) => ask.component !== 'AbovePrompt');
  // the recorded answer at a step, handing back MAWS's props as the engine handed back the probe's
  return (label: string) => (ask: Ask): RenderAnswer => ({ ...recorded.find((r) => r.label === label)!.answer, props: ask.props });
};

const MARK = '<message>Done.</message>';
const TASK = 'Background command "count files" completed (exit code 0)';
const taskEnd: ArrivalEntry = { class: 'task', taskId: 'bt1', toolUseId: 'tu-bt1', runId: 'run-1', outcome: 'completed', summary: TASK, durationMs: null, outputFile: null, detail: null };
// Each lone row, its fixture, and how its session is built
const ROWS: { name: string; kind: Row['kind']; fixture: string; build: (b: ReturnType<typeof builder>) => void; follows?: Row['kind'] }[] = [
  { name: 'a thought', kind: 'thinking', fixture: 'u2b-mod-lone-thought', build: (b) => { b.thinking('m1', 0, 'The notes come first.'); b.text('m1', 1, MARK); } },
  { name: 'an agent listing', kind: 'agent_list', fixture: 'u2b-mod-lone-listing', build: (b) => { b.toolUse('t6', 'ListAgents', {}); b.result('t6', 'No agents are running.'); b.text('m2', 0, MARK); } },
  {
    name: 'a notice with no record of its own', kind: 'notice', fixture: 'u2b-mod-lone-notice', build: (b) => {
      b.toolUse('t1', 'Bash', { command: 'count files' });
      b.result('t1', 'ok');
      b.emit('user.message', { messageUuid: uuid('n1'), content: '', isReplay: true, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [taskEnd] });
      b.text('m2', 0, MARK);
    },
  },
  { name: 'a turn’s line', kind: 'divider', fixture: 'u2b-mod-lone-turn', build: (b) => { b.toolUse('t1', 'Bash', { command: 'ls' }); b.result('t1', 'ok'); b.text('m2', 0, MARK); } },
  { name: 'a time separator', kind: 'time', fixture: 'u2b-mod-lone-turn', follows: 'divider', build: (b) => { b.toolUse('t1', 'Bash', { command: 'ls' }); b.result('t1', 'ok'); b.text('m2', 0, MARK); } },
];

describe('a row mounted with no other row of its stretch is hidden or shown by its own ask', () => {
  it.each(ROWS)('$name: at the first mark, at each switch of the view, and across a reload with no push', async ({ kind, fixture, build, follows }) => {
    const b = builder();
    b.turn('u1', 'Count the files');
    build(b);
    b.end(['u1']);
    const s = await session(b);
    const row = s.rows().find((r) => r.kind === kind)!;
    expect(row, kind).toBeDefined();
    // the time separator follows the line after it, as the mounted list publishes; that line itself is not mounted
    if (follows !== undefined) publishFollows('t', new Map([[row.id, s.rows().find((r) => r.kind === follows)!]]));
    const at = lone(fixture);
    const connection = statusBridge();
    const off = connectEngineSurface(connection.bridge);
    connection.emit(s.id);
    const view = renderRow(row, { storeKey: s.key });
    const text = () => inSight(view.container).trim();
    // before the first mark the mod draws the engine's drawing: MAWS's own row
    await waitFor(() => expect(asks().length).toBeGreaterThan(0));
    const own = text();
    expect(own).not.toBe('');
    const asked = new Set(asks().map((ask) => `${ask.component} ${ask.instanceId}`));
    expect(asked.size).toBe(1); // one ask: the row's own (a follower's is the followed row's, asked at its address)
    const folded = kind === 'divider' || kind === 'time' ? '' : '› working record'; // C4: a lone row heads its run; a lone turn's line is empty
    const steps: [string, () => void, string][] = [
      ['the first mark', () => invalidateSession(s.id), folded],
      ['the full transcript', () => invalidateSession(s.id), own],
      ['back in the report', () => invalidateSession(s.id), folded],
      ['a reload that pushes nothing', () => { s.attach('2026-11-16T10:05:00.000Z'); connection.emit(s.id); }, folded],
    ];
    const labels = ['alone, first ask', 'alone, in the full transcript', 'alone, back in the report', 'alone, just after reload_plugins'];
    for (const [i, [step, act_, seen]] of steps.entries()) {
      const before = asks().length;
      answer = at(labels[i]!);
      act(act_);
      await waitFor(() => expect(text(), step).toBe(seen));
      expect(asks().length, step).toBe(before + 1);
      expect(new Set(asks().map((ask) => `${ask.component} ${ask.instanceId}`)), step).toEqual(asked);
    }
    off();
    publishFollows('t', null);
  });
});

describe('what stands under a row the mod draws', () => {
  // Reported point 23: the action row stands only under a body its answer draws
  it('an answer the mod folds shows no action row and no control a keyboard reaches; with its record opened, it shows one', async () => {
    const b = builder();
    b.turn('u1', 'Count the files');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'ok');
    b.text('m2', 0, 'Three files.');
    b.end(['u1']);
    const s = await session(b);
    const row = s.rows().filter((r): r is Extract<Row, { kind: 'assistant_text' }> => r.kind === 'assistant_text').at(-1)!;
    const placed = new AnswerActionsStore();
    placed.publish(new Map([[row.id, { turnId: row.turnId!, rewindTo: null, fork: false }]]));
    answer = (ask) => EMPTY(ask.props); // the record folded: the answer's site draws nothing
    const view = renderRow(row, { storeKey: s.key, answerActions: placed });
    await waitFor(() => expect(asks().length).toBeGreaterThan(0));
    await waitFor(() => expect(inSight(view.container).trim()).toBe(''));
    expect(view.container.querySelector('.transcript-answer-actions')).toBeNull();
    expect(reachable(view.container)).toEqual([]);
    answer = (ask) => ({ tree: { type: 'Box', children: [{ type: 'engine', ref: 1 }] }, props: ask.props, rewritten: true, hooked: true }); // opened
    act(() => invalidateSession(s.id));
    await waitFor(() => expect(view.container.querySelector('.transcript-answer-actions')).not.toBeNull());
    expect(inSight(view.container)).toContain('Three files.');
  });

  // Reported point 24: a browser activity under a call follows its call's row, and asks nothing of its own
  it('a browser activity under a call is hidden while the mod hides its call’s row and shown while it shows it, asking nothing of its own', async () => {
    const b = builder();
    b.turn('u1', 'Open the page');
    b.toolUse('t1', 'Bash', { command: 'open the page' });
    b.result('t1', 'ok');
    b.text('m2', 0, MARK);
    b.end(['u1']);
    const s = await session(b);
    const call = s.rows().find((r) => r.kind === 'cell' || r.kind === 'group')!;
    const activity: Extract<Row, { kind: 'browser_activity' }> = {
      kind: 'browser_activity', id: 'browser:b_000000000001:1' as never, turnId: call.turnId, at: call.at, toolUseId: 't1' as never, appSessionId: s.id, tabId: 'b_000000000001',
      activity: { kind: 'navigated', url: 'http://127.0.0.1:17391/notes.html', title: 'Notes' },
    } as Extract<Row, { kind: 'browser_activity' }>;
    publishFollows('t', new Map([[activity.id, call]]));
    answer = (ask) => EMPTY(ask.props); // the mod folds the call's row
    const view = renderRow(activity, { storeKey: s.key });
    await waitFor(() => expect(asks().length).toBe(1));
    await waitFor(() => expect(inSight(view.container).trim()).toBe(''));
    answer = (ask) => ENGINE(ask.props);
    act(() => invalidateSession(s.id));
    await waitFor(() => expect(inSight(view.container).trim()).not.toBe(''));
    expect(asks().map((ask) => ask.instanceId).every((id) => !id.includes(activity.id))).toBe(true);
    // a call the live derivation draws as a run asks its run's site, closed too (§E, a call's ask never changes kind)
    expect(new Set(asks().map((ask) => `${ask.component} ${ask.instanceId}`))).toEqual(new Set(['ToolGroup group:t1']));
    publishFollows('t', null);
  });
});
