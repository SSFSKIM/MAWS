import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandInput } from '@shared/ipc/schema';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { BASH_RESULT, builder } from '../model/test-events';
import { renderRow, rowOf, storeWith } from '../view/rows/test-support';

const holder = vi.hoisted(() => ({ client: null as ReturnType<typeof fakeClient>['client'] | null }));
vi.mock('../../ipc/client', () => ({ ipc: { invoke: (...args: Parameters<ReturnType<typeof fakeClient>['client']['invoke']>) => holder.client!.invoke(...args) } }));
let fake: ReturnType<typeof fakeClient>;
const asks = () => fake.invoked('session.ui.render') as CommandInput<'session.ui.render'>[];
beforeEach(() => { resetSurfaceRegistry(); fake = fakeClient(); holder.client = fake.client; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function mounted(b: ReturnType<typeof builder>) {
  const store = await storeWith(b.events); const id = store.key as AppSessionId;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  return store;
}
const engine = { type: 'engine', ref: 0 };
const answer = (props: Record<string, unknown>, tree: unknown = engine, rewritten = false) => ({ tree, props, rewritten, hooked: true });

describe('mounted transcript surface integration', () => {
  it('draws a rewritten assistant body where commentary belongs and releases its ask on unmount', async () => {
    const b = builder(); b.turn('u'); b.text('a', 0, 'working text'); b.toolUse('t', 'Bash', { command: 'pwd' });
    const store = await mounted(b); const row = rowOf(store.rows(), 'assistant_text');
    expect(row.phase).toBe('commentary');
    const view = renderRow(row, { storeKey: store.key });
    expect(asks()[0]).toMatchObject({ component: 'AssistantMessage', instanceId: 'a-u0' });
    await act(() => fake.reply('session.ui.render', answer({ text: 'modded commentary', isFirstOfReply: true }, engine, true)));
    expect(view.container.querySelector('.transcript-commentary')?.textContent).toBe('modded commentary');
    expect(useTranscriptStore.getState().rows(store.key).find((r) => r.id === row.id)).toMatchObject({ markdown: 'working text' });
    view.unmount();
  });

  it('sends display headers to the mod but keeps ANSI out of the unhooked native drawing', async () => {
    const text = '\u001b[1;36mto human\u001b[0m\nHello';
    const b = builder(); b.turn('u'); b.text('a', 0, text);
    const store = await mounted(b); const view = renderRow(rowOf(store.rows(), 'assistant_text'), { storeKey: store.key });
    expect(asks()[0].props.text).toBe(text);
    await act(() => fake.reply('session.ui.render', { ...answer(asks()[0].props), hooked: false }));
    expect(view.container.textContent).toBe('to human\nHello');
  });

  it('keeps the group count line when its mod draws nothing; an expansion rewrite mounts member ToolUse sites', async () => {
    const b = builder(); b.turn('u'); b.toolUse('t1', 'Bash', { command: 'first' }); b.result('t1', 'ok'); b.toolUse('t2', 'Bash', { command: 'second' });
    const store = await mounted(b); const row = rowOf(store.rows(), 'group');
    const view = renderRow(row, { storeKey: store.key });
    const asked = asks()[0];
    expect(asked).toMatchObject({ component: 'ToolGroup', instanceId: 'group:t1' });
    await act(() => fake.reply('session.ui.render', answer({ ...asked.props, isExpanded: true }, { type: 'Box', children: [] }, true)));
    await waitFor(() => expect(rowOf(store.rows(), 'group').expanded).toBe(true));
    view.rerenderRow(rowOf(store.rows(), 'group'));
    expect(view.container.querySelector('[data-cell-count]')?.getAttribute('data-cell-count')).toBe('2');
    expect(view.container.querySelector('.transcript-group-header')).not.toBeNull();
    await waitFor(() => expect(asks().filter((x) => x.component === 'ToolUse').map((x) => x.instanceId)).toEqual(['t1', 't2']));
    expect(asks().filter((x) => x.component === 'ToolResult')).toHaveLength(0);
  });

  it('asks ToolResult for only the mounted standalone resolved output and applies its rewrite inside detail', async () => {
    const b = builder(); b.turn('u'); b.toolUse('t', 'Bash', { command: 'pwd' }); b.result('t', 'original', { structured: BASH_RESULT('original') }); b.end(['u']);
    const store = await mounted(b); act(() => useTranscriptStore.getState().expandAll(store.key));
    const row = rowOf(store.rows(), 'cell'); const view = renderRow(row, { storeKey: store.key });
    await act(() => fake.reply('session.ui.render', { ...answer({}), hooked: false }));
    fireEvent.click(screen.getByRole('button', { name: /pwd/ })); view.rerenderRow(rowOf(store.rows(), 'cell'));
    await waitFor(() => expect(asks().some((x) => x.component === 'ToolResult')).toBe(true));
    const props = asks().find((x) => x.component === 'ToolResult')!.props;
    await act(() => fake.reply('session.ui.render', answer({ ...props, output: BASH_RESULT('rewritten output') }, engine, true)));
    expect(view.container.textContent).toContain('rewritten output'); expect(view.container.textContent).not.toContain('original');
  });

  it.each([true, false])('asks ToolResult from original provenance and preserves the ToolUse drawing (rewrite=%s)', async (rewrite) => {
    const b = builder(); b.turn('u'); b.toolUse('t', 'Bash', { command: 'pwd' }); b.result('t', 'original', { structured: BASH_RESULT('original') }); b.end(['u']);
    const store = await mounted(b); act(() => useTranscriptStore.getState().expandAll(store.key));
    const view = renderRow(rowOf(store.rows(), 'cell'), { storeKey: store.key });
    const toolUse = asks().find((x) => x.component === 'ToolUse')!;
    await act(() => fake.reply('session.ui.render', answer({ ...toolUse.props, tool: 'RenamedShell', input: { command: 'echo drawn command' }, output: BASH_RESULT('ToolUse output') }, engine, true)));
    fireEvent.click(screen.getByRole('button', { name: /RenamedShell/ }));
    view.rerenderRow(rowOf(store.rows(), 'cell'));
    await waitFor(() => expect(asks().some((x) => x.component === 'ToolResult')).toBe(true));
    const result = asks().find((x) => x.component === 'ToolResult')!;
    expect(result.props).toEqual({ tool_use_id: 't', tool: 'Bash', output: BASH_RESULT('original'), isErrored: false });
    const stored = structuredClone(useTranscriptStore.getState().rows(store.key));
    await act(() => fake.reply('session.ui.render', answer(rewrite ? { ...result.props, output: BASH_RESULT('ToolResult output') } : result.props, engine, rewrite)));
    expect(view.container.textContent).toContain('RenamedShell');
    expect(view.container.textContent).toContain('echo drawn command');
    expect(view.container.textContent).toContain(rewrite ? 'ToolResult output' : 'ToolUse output');
    expect(view.container.textContent).not.toContain(rewrite ? 'ToolUse output' : 'ToolResult output');
    expect(view.container.textContent).not.toContain('pwd');
    expect(useTranscriptStore.getState().rows(store.key)).toEqual(stored);
    expect(rowOf(stored, 'cell')).toMatchObject({ detail: { command: 'pwd' } });
  });

  it('lets each hooked member of a merged read disclose its own native detail', async () => {
    fake = fakeClient({ 'session.ui.render': (request: CommandInput<'session.ui.render'>) => answer(request.props) }); holder.client = fake.client;
    const b = builder(); b.turn('u'); b.toolUse('r1', 'Read', { file_path: '/a' }); b.result('r1', 'first file'); b.toolUse('r2', 'Read', { file_path: '/b' }); b.result('r2', 'second file'); b.toolUse('g', 'Grep', { pattern: 'find' });
    const store = await mounted(b); act(() => useTranscriptStore.getState().expandAll(store.key));
    const view = renderRow(rowOf(store.rows(), 'group'), { storeKey: store.key });
    await waitFor(() => expect(asks().filter((x) => x.component === 'ToolUse')).toHaveLength(3));
    const first = view.container.querySelector('[data-cell-id="cell:r1"] button')!;
    const second = view.container.querySelector('[data-cell-id="cell:r2"] button')!;
    expect(first).not.toBeNull(); expect(second).not.toBeNull();
    fireEvent.click(first);
    await waitFor(() => expect(first.getAttribute('aria-expanded')).toBe('true'));
    expect(second.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not ask sites for other row kinds or queued prompts', async () => {
    const b = builder(); b.turn('u'); const store = await mounted(b); const row = rowOf(store.rows(), 'user');
    renderRow({ ...row, pending: 'next' }, { storeKey: store.key });
    expect(asks()).toHaveLength(0);
    renderRow(rowOf(store.rows(), 'divider'), { storeKey: store.key });
    expect(asks().filter((x) => x.component !== 'Spinner')).toHaveLength(0);
  });
});
