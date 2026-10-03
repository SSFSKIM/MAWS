import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useSessions } from '../stores/sessions';
import { invalidateSession, resetSurfaceRegistry } from './registry';
import { SurfaceRow } from './SurfaceRow';

const ID = 'r3-rows' as AppSessionId;
const props = { text: 'native', isFirstOfReply: true };
const answer = (tree: unknown, overrides = {}) => ({ tree, props, hooked: true, rewritten: false, ...overrides });
const native = { type: 'engine', ref: 0 };
let fake: FakeClient;
beforeEach(() => {
  resetSurfaceRegistry();
  fake = fakeClient();
  useSessions.setState({ engine: new Map([[ID, { ...status(ID), uiSurface: { clientId: 'maws-main' } }]]) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const reply = (value: unknown) => act(() => fake.reply('session.ui.render', value));
function Row({ id = 'a', text = 'native', enabled = true }: { id?: string; text?: string; enabled?: boolean }) {
  return <SurfaceRow appSessionId={ID} component="AssistantMessage" instanceId={id} props={{ ...props, text }} enabled={enabled} client={fake.client}>{(p) => <button>{p.text}</button>}</SurfaceRow>;
}

describe('SurfaceRow outcomes', () => {
  it('draws native before hook knowledge, while disabled, and when no plugin hooks the component', async () => {
    const view = render(<Row enabled={false} />);
    expect(screen.getByRole('button', { name: 'native' })).toBeTruthy();
    expect(fake.pending('session.ui.render')).toBe(0);
    view.rerender(<Row />);
    await reply(answer(native, { hooked: false }));
    expect(screen.getByRole('button', { name: 'native' })).toBeTruthy();
    view.rerender(<Row id="later" text="later" />);
    expect(screen.getByRole('button', { name: 'later' })).toBeTruthy();
    expect(fake.invoked('session.ui.render')).toHaveLength(1);
  });

  it('applies rewritten props even when the tree is bare engine ref zero', async () => {
    render(<Row />);
    await reply(answer(native, { rewritten: true, props: { ...props, text: 'rewritten' } }));
    expect(screen.getByRole('button', { name: 'rewritten' })).toBeTruthy();
    expect(screen.queryByText('native')).toBeNull();
  });

  it('refuses the whole drawing for an invalid rewrite and warns only once per component', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = render(<Row />);
    const invalid = answer({ type: 'Text', children: ['must refuse'] }, { rewritten: true, props: { text: 42, isFirstOfReply: true } });
    await reply(invalid);
    expect(screen.getByRole('button', { name: 'native' })).toBeTruthy();
    expect(screen.queryByText('must refuse')).toBeNull();
    view.rerender(<Row id="b" />);
    await reply(invalid);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('places native once at the first engine node, with the single answer rewrite', async () => {
    render(<Row />);
    await reply(answer({ type: 'Box', children: ['before', { type: 'engine', ref: 8 }, 'after', { type: 'engine', ref: 9 }, { type: 'engine', ref: 8 }] }, { rewritten: true, props: { ...props, text: 'inside' } }));
    const body = screen.getByRole('button', { name: 'inside' });
    expect(body.closest('[data-surface="box"]')?.textContent).toBe('beforeinsideafter');
  });

  it('replaces or hides the row while preserving inaccessible native state, then restores it', async () => {
    let mounts = 0;
    function Native() {
      useEffect(() => { mounts += 1; }, []);
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count + 1)}>count {count}</button>;
    }
    render(<SurfaceRow appSessionId={ID} component="AssistantMessage" instanceId="stateful" props={props} client={fake.client}>{() => <Native />}</SurfaceRow>);
    fireEvent.click(screen.getByRole('button', { name: 'count 0' }));
    await reply(answer({ type: 'Text', children: ['replacement'] }));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('count 1').closest('[inert]')).toBeTruthy();
    expect(screen.getByText('replacement')).toBeTruthy();
    act(() => invalidateSession(ID));
    await reply(answer({ type: 'Box', children: [' '] }));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('replacement')).toBeNull();
    act(() => invalidateSession(ID));
    await reply(answer({ type: 'Box', children: [{ type: 'engine', ref: 2 }] }));
    expect(screen.getByRole('button', { name: 'count 1' })).toBeTruthy();
    expect(mounts).toBe(1);
  });

  it('conceals a known-hooked pending row immediately and shows an ellipsis after five seconds', async () => {
    const first = render(<Row />);
    await reply(answer(native));
    first.unmount();
    vi.useFakeTimers();
    render(<Row id="pending" text="secret" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('secret').closest('[inert]')).toBeTruthy();
    const nativePlacement = screen.getByText('secret').closest('[data-engine-slot]')!.parentElement!;
    expect(nativePlacement.style.display).toBe('contents');
    expect(screen.queryByText('…')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(4999));
    expect(screen.queryByText('…')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('…')).toBeTruthy();
    expect(nativePlacement.style.display).toBe('none');
    const resolving = reply(answer(native));
    await vi.advanceTimersByTimeAsync(0);
    await resolving;
    expect(screen.getByRole('button', { name: 'secret' })).toBeTruthy();
    expect(screen.queryByText('…')).toBeNull();
  });

  it('does not conceal an already visible row when a sibling first discovers the component is hooked', async () => {
    render(<><Row id="first" text="first native" /><Row id="second" text="already visible" /></>);
    expect(screen.getByRole('button', { name: 'already visible' })).toBeTruthy();
    await reply(answer(native));
    expect(screen.getByRole('button', { name: 'already visible' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'already visible' }).closest('[inert]')).toBeNull();
  });

  it('withholds only the initial known-hooked answer, then keeps its drawing during streaming reasks', async () => {
    const first = render(<Row />);
    await reply(answer(native));
    first.unmount();
    const view = render(<Row id="streaming" />);
    expect(screen.queryByRole('button')).toBeNull();
    await reply(answer({ type: 'Box', children: ['mod ink', { type: 'engine', ref: 7 }] }));
    expect(screen.getByRole('button', { name: 'native' })).toBeTruthy();
    view.rerender(<Row id="streaming" text="next streamed text" />);
    expect(screen.getByText('mod ink')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'next streamed text' })).toBeTruthy();
    expect(screen.getByRole('button').closest('[inert]')).toBeNull();
    vi.useFakeTimers();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(screen.queryByText('…')).toBeNull();
    vi.useRealTimers();
  });

  it('starts a fresh withholding deadline when the mounted row identity changes', async () => {
    const first = render(<Row />);
    await reply(answer(native));
    first.unmount();
    vi.useFakeTimers();
    const view = render(<Row id="first-pending" />);
    await act(() => vi.advanceTimersByTimeAsync(4000));
    view.rerender(<Row id="second-pending" />);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.queryByText('…')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(screen.getByText('…')).toBeTruthy();
  });

  it('defers answer replacement during a pointer gesture and applies it after release', async () => {
    render(<Row />);
    await reply(answer({ type: 'Text', children: ['selectable'] }));
    fireEvent.pointerDown(screen.getByText('selectable'), { button: 0, buttons: 1 });
    act(() => invalidateSession(ID));
    await reply(answer({ type: 'Text', children: ['updated'] }));
    expect(screen.getByText('selectable')).toBeTruthy();
    expect(screen.queryByText('updated')).toBeNull();
    fireEvent.pointerUp(document);
    await act(() => new Promise((resolve) => setTimeout(resolve, 1)));
    expect(screen.getByText('updated')).toBeTruthy();
  });

  it('does not draw an old-props answer over a streaming row', async () => {
    const view = render(<Row />);
    view.rerender(<Row text="new native" />);
    await reply(answer(native, { rewritten: true, props: { ...props, text: 'stale rewrite' } }));
    expect(screen.queryByText('stale rewrite')).toBeNull();
    await reply(answer(native, { rewritten: true, props: { ...props, text: 'current rewrite' } }));
    expect(screen.getByRole('button', { name: 'current rewrite' })).toBeTruthy();
  });

  it('ToolResult ignores equal-props drawings and applies changed rewrites without an inkless frame', async () => {
    const tool = { tool_use_id: 'tool', tool: 'Bash', output: 'original', isErrored: false };
    render(<SurfaceRow appSessionId={ID} component="ToolResult" instanceId="tool" props={tool} onlyRewrites frameInkOnly client={fake.client}>{(p) => <button>{String(p.output)}</button>}</SurfaceRow>);
    await reply(answer({ type: 'Text', children: ['ignored'] }, { props: tool }));
    expect(screen.getByRole('button', { name: 'original' })).toBeTruthy();
    expect(screen.queryByText('ignored')).toBeNull();
    act(() => invalidateSession(ID));
    await reply(answer({ type: 'Text', children: ['also ignored'] }, { rewritten: true, props: { isErrored: false, output: 'original', tool: 'Bash', tool_use_id: 'tool' } }));
    expect(screen.queryByText('also ignored')).toBeNull();
    act(() => invalidateSession(ID));
    await reply(answer({ type: 'Box', children: [{ type: 'engine', ref: 6 }] }, { rewritten: true, props: { ...tool, output: 'rewritten output' } }));
    expect(screen.getByRole('button', { name: 'rewritten output' })).toBeTruthy();
    expect(document.querySelector('[data-plugin-drawn]')).toBeNull();
  });

  it('ToolGroup draws only ink beside its group and delivers each accepted expansion once', async () => {
    const group = { calls: [{ tool: 'Bash', input: { command: 'pwd' }, isRunning: true, isErrored: false, isInterrupted: false }], isActive: true, isExpanded: false };
    const expanded = vi.fn();
    const make = () => <SurfaceRow appSessionId={ID} component="ToolGroup" instanceId="group:tool" props={group} drawingOnly onRewrite={(p) => expanded(p)} client={fake.client}>{() => <button>must not draw group twice</button>}</SurfaceRow>;
    const view = render(make());
    await reply(answer(native, { props: { ...group, isExpanded: true }, rewritten: true }));
    expect(expanded).toHaveBeenCalledTimes(1);
    expect(expanded.mock.calls[0]![0].isExpanded).toBe(true);
    view.rerender(make());
    expect(expanded).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button')).toBeNull();
    act(() => invalidateSession(ID));
    await reply(answer({ type: 'Box', children: [{ type: 'engine', ref: 4 }, 'group drawing'] }, { props: group }));
    expect(screen.getByText('group drawing')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    act(() => invalidateSession(ID));
    await reply(answer({ type: 'Box', children: [{ type: 'engine', ref: 3 }] }, { props: group }));
    expect(document.querySelector('[data-plugin-drawn]')).toBeNull();
  });

  it('supplies concealment to native children for ancestor-bound shortcut cleanup', async () => {
    render(<SurfaceRow appSessionId={ID} component="AssistantMessage" instanceId="context" props={props} client={fake.client}>{(_, { concealed }) => <button data-shortcuts={concealed ? 'off' : 'on'}>native control</button>}</SurfaceRow>);
    await reply(answer({ type: 'Text', children: ['replacement'] }));
    expect(screen.getByText('native control').getAttribute('data-shortcuts')).toBe('off');
  });

  it('a later Client fallback cannot steal the persistent native host from its engine slot', async () => {
    render(<Row />);
    const client = { type: 'Client', props: { key: 'board', module: 'board.js' }, client: { plugin: 'probe' } };
    await reply(answer({ type: 'Box', children: [
      { type: 'Box', children: ['engine placement', { type: 'engine', ref: 7 }] },
      { type: 'Box', children: ['client placement', client] },
    ] }));
    expect(screen.getByRole('button', { name: 'native' }).closest('[data-surface="box"]')?.textContent).toBe('engine placementnative');
  });

  it('Client falls back to native, not a feature-unavailable note', async () => {
    render(<Row />);
    await reply(answer({ type: 'Client', props: { key: 'board', module: 'board.js' }, client: { plugin: 'probe' } }));
    expect(screen.getByRole('button', { name: 'native' })).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });
});
