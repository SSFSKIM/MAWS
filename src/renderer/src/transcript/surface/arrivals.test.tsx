// UX wave U3, first landing (docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, M5; Acceptance 8): in a session
// whose mods surface is attached, the row of a message from another session and of a task's end from a replayed frame
// ask the engine's UserMessage site, and a message the agent sent asks ToolUse, so that a mod can fold or draw them as
// it does in the terminal; with no hook, or a hook that keeps the engine's drawing, MAWS's line stands. A line the host
// made itself asks nothing, and neither does the row a jump revealed. Every word is invented.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArrivalEntry } from '@shared/engine/arrival-schema';
import type { CommandInput } from '@shared/ipc/schema';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import type { Row } from '../model/rows';
import { builder, uuid } from '../model/test-events';
import { renderRow, storeWith } from '../view/rows/test-support';

const holder = vi.hoisted(() => ({ client: null as ReturnType<typeof fakeClient>['client'] | null }));
vi.mock('../../ipc/client', () => ({ ipc: { invoke: (...args: Parameters<ReturnType<typeof fakeClient>['client']['invoke']>) => (holder.client!.invoke as unknown as (...a: unknown[]) => unknown)(...args) } }));
let fake: ReturnType<typeof fakeClient>;
const asks = (component: string) => (fake.invoked('session.ui.render') as CommandInput<'session.ui.render'>[]).filter((ask) => ask.component === component);
beforeEach(() => { resetSurfaceRegistry(); fake = fakeClient(); holder.client = fake.client; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function mounted(b: ReturnType<typeof builder>) {
  const store = await storeWith(b.events);
  const id = store.key as AppSessionId;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  return store;
}
const engine = { type: 'engine', ref: 0 };
const answer = (props: unknown, tree: unknown = engine) => ({ tree, props, rewritten: false, hooked: true });
const of = <K extends Row['kind']>(rows: Row[], kind: K) => rows.find((row): row is Extract<Row, { kind: K }> => row.kind === kind)!;

const INBOX = 'Another Claude session sent a message:\n<cross-session-message from-name="docs">\nthe index is stale\n</cross-session-message>';
const TASK = '<task-notification>\n<task-id>bt1</task-id>\n<tool-use-id>tu-bt1</tool-use-id>\n<status>failed</status>\n<summary>Background command "count files" failed with exit code 1</summary>\n</task-notification>';
const taskEnd: ArrivalEntry = { class: 'task', taskId: 'bt1', toolUseId: 'tu-bt1', runId: 'run-1', outcome: 'failed', summary: 'Background command "count files" failed with exit code 1', durationMs: null, outputFile: null, detail: null };

// A peer's message the engine's inbox delivered, in a turn it opened (left running, so its line is in the rows).
function inbound() {
  const b = builder();
  b.emit('turn.started', { userMessageUuid: null, origin: 'peer' });
  b.emit('user.message', { messageUuid: uuid('p1'), content: INBOX, isReplay: true, isSynthetic: true, origin: 'peer', bash: null });
  b.emit('peer.message', { messageUuid: uuid('p1'), from: 'uds:/tmp/socks/docs.sock', fromSession: null, fromName: 'docs', fromMode: null, fromPlugin: null, hopChain: [], text: 'the index is stale', midTurn: false, lineage: 'peer', replyable: true });
  return b;
}
// A task's end in the turn the engine opened for it: from the replayed frame, or (content '') told while idle.
function taskTurn(content: string) {
  const b = builder();
  b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
  b.emit('user.message', { messageUuid: uuid('n1'), content, isReplay: true, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [taskEnd] });
  return b;
}
const line = (container: HTMLElement) => container.querySelector('.transcript-line-text')?.textContent;
// The native drawing is concealed (inert, out of the accessibility tree) when a mod's drawing replaces it.
const concealed = (container: HTMLElement, selector: string) => container.querySelector(selector)?.closest('[inert]') !== null;

describe('the arrival rows with a mods surface attached', () => {
  it.each([
    ['no hook', { ...answer({}), hooked: false }],
    ['a hook that keeps the engine’s drawing', null],
  ])('a message from another session asks UserMessage with the engine’s props; %s leaves MAWS’s line', async (_, given) => {
    const store = await mounted(inbound());
    const view = renderRow(of(store.rows(), 'agent_message'), { storeKey: store.key });
    expect(asks('UserMessage')).toHaveLength(1);
    expect(asks('UserMessage')[0]).toMatchObject({ instanceId: 'p1', props: { text: 'the index is stale', origin: { kind: 'peer' }, isExpanded: false, from: { name: 'docs' } } });
    await act(() => fake.reply('session.ui.render', given ?? answer(asks('UserMessage')[0]!.props)));
    expect(line(view.container)).toBe('Message from @docs: the index is stale');
    expect(concealed(view.container, '.transcript-peer')).toBe(false);
  });

  it('an answer that draws without the engine’s drawing replaces the line', async () => {
    const store = await mounted(inbound());
    const view = renderRow(of(store.rows(), 'agent_message'), { storeKey: store.key });
    await act(() => fake.reply('session.ui.render', answer(asks('UserMessage')[0]!.props, { type: 'Text', children: ['folded by a mod'] })));
    expect(view.container.querySelector('[data-plugin-drawn="UserMessage"]')?.textContent).toBe('folded by a mod');
    expect(concealed(view.container, '.transcript-peer')).toBe(true);
  });

  it('opening the line asks again with the message expanded', async () => {
    const store = await mounted(inbound());
    renderRow(of(store.rows(), 'agent_message'), { storeKey: store.key });
    fireEvent.click(screen.getByRole('button', { name: /^Message from @docs/ }));
    expect(asks('UserMessage').at(-1)?.props).toMatchObject({ isExpanded: true });
  });

  it('a task’s end from a replayed frame asks UserMessage with its <summary> and the task’s fields', async () => {
    const store = await mounted(taskTurn(TASK));
    const view = renderRow(of(store.rows(), 'notice'), { storeKey: store.key });
    expect(asks('UserMessage')).toHaveLength(1);
    expect(asks('UserMessage')[0]).toMatchObject({ instanceId: 'n1', props: { text: 'Background command "count files" failed with exit code 1', origin: { kind: 'task-notification' }, task: { id: 'bt1', status: 'failed', toolUseId: 'tu-bt1' } } });
    await act(() => fake.reply('session.ui.render', answer(asks('UserMessage')[0]!.props)));
    expect(line(view.container)).toBe('Background command "count files" failed with exit code 1');
    expect(concealed(view.container, '.transcript-notice')).toBe(false);
  });

  it('a notice the host made itself asks nothing and is drawn by MAWS', async () => {
    const store = await mounted(taskTurn(''));
    const view = renderRow(of(store.rows(), 'notice'), { storeKey: store.key });
    expect(asks('UserMessage')).toHaveLength(0);
    expect(line(view.container)).toBe('Background command "count files" failed with exit code 1');
  });

  it('a message the agent sent asks ToolUse with its call’s props, and a drawing without the engine’s replaces its line', async () => {
    const b = builder();
    b.turn('u');
    b.toolUse('sm1', 'SendMessage', { to: 'uds:/tmp/socks/docs.sock', message: 'the index is fixed' });
    b.result('sm1', '{"success":true}');
    const store = await mounted(b);
    const view = renderRow(of(store.rows(), 'agent_message'), { storeKey: store.key });
    expect(asks('UserMessage')).toHaveLength(0);
    expect(asks('ToolUse')).toHaveLength(1);
    expect(asks('ToolUse')[0]).toMatchObject({ instanceId: 'sm1', props: { tool_use_id: 'sm1', tool: 'SendMessage', input: { to: 'uds:/tmp/socks/docs.sock', message: 'the index is fixed' }, isRunning: false, isErrored: false, output: '{"success":true}' } });
    expect(concealed(view.container, '.transcript-peer')).toBe(false);
    await act(() => fake.reply('session.ui.render', answer(asks('ToolUse')[0]!.props, { type: 'Text', children: ['sent, as a mod draws it'] })));
    expect(view.container.querySelector('[data-plugin-drawn="ToolUse"]')?.textContent).toBe('sent, as a mod draws it');
    expect(concealed(view.container, '.transcript-peer')).toBe(true);
  });

  it('the row a jump revealed asks no site and is drawn by MAWS', async () => {
    const store = await mounted(inbound());
    const row = of(store.rows(), 'agent_message');
    act(() => useTranscriptStore.getState().jumpTo(store.key, row.id));
    expect(useTranscriptStore.getState().entries[store.key]!.state.ui.revealed).toBe(row.id);
    const view = renderRow(of(store.rows(), 'agent_message'), { storeKey: store.key });
    expect(asks('UserMessage')).toHaveLength(0);
    expect(line(view.container)).toBe('Message from @docs: the index is stale');
  });
});
