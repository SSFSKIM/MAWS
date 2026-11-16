// UX wave U2b, M5's fix wave 1 (the execution document, §E "A call's ask never changes kind over its row's life"; the
// Decision Log, "M5, a call's ask by its row's live identity"): a call that the live derivation draws as a run, of one
// or more, asks `ToolGroup` under its run's id with its calls for its row's whole life: live, once its turn has closed,
// once following text has flushed it, and in a window that reads the session from its file with no earlier state. A
// call that never joins a run asks `ToolUse`. Real events through the real derivation; the mod's answer is check 1's
// E3 `-group` recording's. Every text is invented.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderAnswer } from '@shared/engine/surface';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../../test/support/builders';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { builder } from '../model/test-events';
import { Disclosures, TranscriptProvider } from '../view/context';
import { RowView } from '../view/rows/Row';
import { spyActions, storeWith } from '../view/rows/test-support';
import { ONE_CALL, oneCallTranscript, recordedAsks, seedEvents, type OneCallResult } from './mod-test-support';

type Ask = { name: string; component: string; instanceId: string; props: Record<string, unknown> };
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
let answer: (ask: Ask) => RenderAnswer;
beforeEach(() => {
  resetSurfaceRegistry();
  holder.calls = [];
  answer = (ask) => ENGINE(ask.props);
  holder.answer = (name, input) => (name === 'session.ui.render' || name === 'session.ui.renderSite' ? answer({ name, ...(input as Omit<Ask, 'name'>) }) : undefined);
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map() });
  resetSurfaceRegistry();
});
const asks = () => holder.calls.filter((call) => call.name === 'session.ui.render').map((call) => ({ name: call.name, ...(call.input as Omit<Ask, 'name'>) }));
const callAsks = (call: string) => asks().filter((ask) => ask.instanceId === call || ask.instanceId === `group:${call}`).map((ask) => `${ask.component} ${ask.instanceId}`);
const callsOf = (ask: Ask | undefined) => (ask?.props.calls as { tool_use_id: string }[] | undefined)?.map((c) => c.tool_use_id);

// The session's rows as the window draws them, re-drawn as the derivation changes them, where the surface is attached
function Rows({ storeKey }: { storeKey: string }) {
  const rows = useTranscriptStore((state) => state.entries[storeKey]?.rows ?? []);
  return <>{rows.map((row) => <div key={row.id} data-row={row.id}><RowView row={row} /></div>)}</>;
}
async function mount(events: SessionEvent[]) {
  const store = await storeWith(events);
  const id = store.key as AppSessionId;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  act(() => useTranscriptStore.getState().setToHumanView(store.key, { lane: false, tailMessage: false, modDraws: true }));
  const value = { storeKey: store.key, variant: 'session' as const, actions: spyActions(), rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 't', effort: null };
  const view = render(<TranscriptProvider value={value}><Rows storeKey={store.key} /></TranscriptProvider>);
  return { ...store, view, push: (batch: SessionEvent[]) => act(() => store.push(batch)) };
}
const lastAskOf = (instanceId: string) => asks().filter((ask) => ask.instanceId === instanceId).at(-1);
const everyCallAsk = () => new Set(asks().filter((ask) => ask.component === 'ToolUse' || ask.component === 'ToolGroup').map((ask) => `${ask.component} ${ask.instanceId}`));
const cellOf = (rows: { kind: string }[], call: string) => rows.find((row) => row.kind === 'cell' && (row as { toolUseId?: string }).toolUseId === call) as { classification: { groupable: boolean } } | undefined;

describe('a call’s ask never changes kind over its row’s life', () => {
  it('a run of one asks ToolGroup under its run’s id live, after its turn’s end, and after following text flushes it', async () => {
    const b = builder();
    b.turn('u1', 'List the notes');
    b.toolUse('t1', 'Bash', { command: 'ls notes' });
    b.result('t1', 'alpha.txt');
    const s = await mount([...b.events]);
    expect(s.rows().map((row) => row.kind)).toContain('group'); // live: a run of one
    await waitFor(() => expect(callAsks('t1')).toEqual(['ToolGroup group:t1']));
    const live = lastAskOf('group:t1')!;
    expect(callsOf(live)).toEqual(['t1']);

    let sent = b.events.length;
    b.text('m1', 0, '<message>Listed.</message>'); // the text flushes the run: the derivation draws the call alone
    s.push(b.events.slice(sent));
    expect(s.rows().find((row) => row.kind === 'cell' || row.kind === 'group')!.kind).toBe('cell');
    await waitFor(() => expect(asks().length).toBeGreaterThan(1));
    expect(new Set(callAsks('t1'))).toEqual(new Set(['ToolGroup group:t1']));
    expect(lastAskOf('group:t1')!.props.calls).toEqual(live.props.calls);

    sent = b.events.length;
    b.end(['u1']); // the turn closes
    s.push(b.events.slice(sent));
    await waitFor(() => expect(s.rows().some((row) => row.kind === 'cell')).toBe(true));
    expect(new Set(callAsks('t1'))).toEqual(new Set(['ToolGroup group:t1']));
    expect(lastAskOf('group:t1')!.props.calls).toEqual(live.props.calls);
  });

  it('read from the file with no earlier state, the closed call asks what the live window asked', async () => {
    await mount(await seedEvents(oneCallTranscript()));
    await waitFor(() => expect(callAsks(ONE_CALL)).toEqual([`ToolGroup group:${ONE_CALL}`]));
    expect(callsOf(lastAskOf(`group:${ONE_CALL}`))).toEqual([ONE_CALL]);
  });

  it('a second call joining the run keeps its id', async () => {
    const b = builder();
    b.turn('u1', 'List the notes');
    b.toolUse('t1', 'Bash', { command: 'ls notes' });
    b.result('t1', 'alpha.txt');
    const s = await mount([...b.events]);
    await waitFor(() => expect(callAsks('t1')).toEqual(['ToolGroup group:t1']));
    const sent = b.events.length;
    b.toolUse('t2', 'Bash', { command: 'wc -l notes/*' });
    s.push(b.events.slice(sent));
    await waitFor(() => expect(callsOf(lastAskOf('group:t1'))).toEqual(['t1', 't2']));
    expect(asks().filter((ask) => ask.component === 'ToolGroup').map((ask) => ask.instanceId).every((id) => id === 'group:t1')).toBe(true);
  });

  it('a call that never joins a run asks ToolUse, live and closed', async () => {
    const b = builder();
    b.turn('u1', 'Look at the screen');
    b.toolUse('c1', 'mcp__cua_repl__js', { code: 'screenshot()' });
    b.result('c1', 'ok');
    const s = await mount([...b.events]);
    expect(s.rows().find((row) => row.kind === 'cell' && row.toolUseId === 'c1')).toBeDefined();
    await waitFor(() => expect(callAsks('c1')).toEqual(['ToolUse c1']));
    const sent = b.events.length;
    b.text('m1', 0, 'Looked.');
    b.end(['u1']);
    s.push(b.events.slice(sent));
    await waitFor(() => expect(asks().length).toBeGreaterThan(1));
    expect(new Set(callAsks('c1'))).toEqual(new Set(['ToolUse c1']));
  });

  // Check 1's E3 `-group` (u2b-mod-mock-grow-9-after-group-fix): a group of one keeps its stretch's line; the mod's kit
  // holds it across a turn's end and with no earlier state. Its answer to the group of one is drawn on the closed call.
  it('where the mod draws as recorded, the closed stretch of one call has its record line, and the line opens it', async () => {
    const recorded = recordedAsks('u2b-mod-mock-grow-9-after-group-fix').find((ask) => ask.component === 'ToolGroup' && (ask.props.calls as unknown[]).length === 1)!;
    answer = (ask) => (ask.component === 'ToolGroup' ? { ...recorded.answer, props: ask.props } : ENGINE(ask.props));
    const s = await mount(await seedEvents(oneCallTranscript()));
    const cell = s.rows().find((row) => row.kind === 'cell')!;
    const slot = s.view.container.querySelector(`[data-row="${cell.id}"]`)!;
    await waitFor(() => expect(slot.querySelector('button')?.textContent).toBe('› Grow step 0'));
    expect(slot.querySelector('[data-plugin-drawn="ToolGroup"]')).not.toBeNull();
    fireEvent.click(slot.querySelector('button')!);
    await waitFor(() => expect(holder.calls.some((call) => call.name === 'session.ui.press')).toBe(true));
    const press = recorded.answer.tree as unknown as { children: { children: { press?: unknown }[] }[] };
    expect(holder.calls.find((call) => call.name === 'session.ui.press')!.input).toMatchObject(press.children[0]!.children.find((child) => child.press)!.press as object);
  });
});

// M5's fix wave 2 (§E, restated at M5's second review; the Decision Log, "the ask's kind by the tool's own table row"):
// the kind is the tool's own row of the classification table, so a result that makes a call standalone once it arrives
// (an image, a refusal that is not a stopped member) never moves it
const IMAGE = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }];
const RESULTS: { name: string; tool: string; input: Record<string, unknown>; live: [string | Record<string, unknown>[], Record<string, unknown>]; file: OneCallResult }[] = [
  {
    name: 'its image result', tool: 'Read', input: { file_path: '/notes/shot.png' },
    live: [IMAGE, { structured: { isImage: true } }],
    file: { content: [...IMAGE, { type: 'text', text: '[Image: source: /notes/shot.png]' }], record: {} },
  },
  {
    name: 'a refusal that is not a stopped member', tool: 'Bash', input: { command: 'rm notes/alpha.txt' },
    live: ['Refused by an invented rule.', { isError: true, denial: 'permission-rule' }],
    file: { content: 'Refused by an invented rule.', isError: true, record: { toolUseResult: 'Error: Refused by an invented rule.', toolDenialKind: 'permission-rule' } },
  },
];

describe('the ask’s kind is the tool’s own table row: a result never moves it', () => {
  it.each(RESULTS)('a pending single groupable call, then $name: ToolGroup under group:<call> throughout, live', async ({ tool, input, live: [content, options] }) => {
    const b = builder();
    b.turn('u1', 'Look at the notes');
    b.toolUse('t1', tool, input);
    const s = await mount([...b.events]);
    await waitFor(() => expect(callAsks('t1')).toEqual(['ToolGroup group:t1'])); // pending: a run of one

    let sent = b.events.length;
    b.result('t1', content as never, options);
    s.push(b.events.slice(sent));
    expect(cellOf(s.rows(), 't1')?.classification.groupable).toBe(false); // the result made the call standalone
    await waitFor(() => expect(asks().length).toBeGreaterThan(1));
    expect(new Set(callAsks('t1'))).toEqual(new Set(['ToolGroup group:t1']));
    expect(callsOf(lastAskOf('group:t1'))).toEqual(['t1']);

    sent = b.events.length;
    b.text('m1', 0, '<message>Looked.</message>');
    b.end(['u1']);
    s.push(b.events.slice(sent));
    await waitFor(() => expect(asks().length).toBeGreaterThan(2));
    expect(new Set(callAsks('t1'))).toEqual(new Set(['ToolGroup group:t1']));
  });

  it.each(RESULTS)('read from the file, a single groupable call with $name asks ToolGroup under group:<call>', async ({ tool, input, file }) => {
    const s = await mount(await seedEvents(oneCallTranscript(tool, input, file)));
    expect(cellOf(s.rows(), ONE_CALL)?.classification.groupable).toBe(false);
    await waitFor(() => expect(callAsks(ONE_CALL)).toEqual([`ToolGroup group:${ONE_CALL}`]));
    expect(callsOf(lastAskOf(`group:${ONE_CALL}`))).toEqual([ONE_CALL]);
  });

  it('a run its member’s image result splits: each former member, now alone, asks ToolGroup under group:<its call>, none ToolUse', async () => {
    const b = builder();
    b.turn('u1', 'Look at the notes');
    b.toolUse('t1', 'Read', { file_path: '/notes/alpha.txt' });
    b.result('t1', 'alpha');
    b.toolUse('t2', 'Read', { file_path: '/notes/shot.png' });
    const s = await mount([...b.events]);
    await waitFor(() => expect(callsOf(lastAskOf('group:t1'))).toEqual(['t1', 't2']));

    const sent = b.events.length;
    b.result('t2', IMAGE as never, { structured: { isImage: true } });
    s.push(b.events.slice(sent));
    expect(['t1', 't2'].map((call) => cellOf(s.rows(), call) !== undefined)).toEqual([true, true]); // both now stand alone
    await waitFor(() => expect(callsOf(lastAskOf('group:t2'))).toEqual(['t2']));
    expect(callsOf(lastAskOf('group:t1'))).toEqual(['t1']);
    expect(everyCallAsk()).toEqual(new Set(['ToolGroup group:t1', 'ToolGroup group:t2']));
  });

  it('a call whose table row is standalone asks ToolUse throughout: pending, at its result, closed, and from the file', async () => {
    const b = builder();
    b.turn('u1', 'Look at the screen');
    b.toolUse('c1', 'mcp__cua_repl__js', { code: 'screenshot()' });
    const s = await mount([...b.events]);
    await waitFor(() => expect(callAsks('c1')).toEqual(['ToolUse c1']));
    const sent = b.events.length;
    b.result('c1', IMAGE as never, { structured: { isImage: true } });
    b.text('m1', 0, 'Looked.');
    b.end(['u1']);
    s.push(b.events.slice(sent));
    await waitFor(() => expect(asks().length).toBeGreaterThan(1));
    expect(new Set(callAsks('c1'))).toEqual(new Set(['ToolUse c1']));

    cleanup();
    holder.calls = [];
    resetSurfaceRegistry();
    await mount(await seedEvents(oneCallTranscript('mcp__cua_repl__js', { code: 'screenshot()' })));
    await waitFor(() => expect(callAsks(ONE_CALL)).toEqual([`ToolUse ${ONE_CALL}`]));
  });
});
