// R2 (charter D-9 as amended 2026-10-01; the waves plan's R2 rulings): the host side of the remote surface. The
// session attaches as "desktop" right after initialize when the engine advertises `ui_surface_v1` and reads the roster,
// detaches before `end_session`, and holds the engine's requests to the surface for the renderer, refusing one nobody
// answered just inside the engine's 5 s; the X2 commands write the `ui_*` requests with the attach's address; the app's
// replay answers the surface's reads from the fixture as of the cursor, in whatever order the renderer asks them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestId } from '@shared/graph/ids';
import type { ControlRequestFrame, StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { loadJournal } from '../../test/support/fixtures';
import { handshakePrelude } from './conformance/harness';
import { handshakeResponder, INIT_RESPONSE, scriptedSession } from './conformance/session-harness';
import { replayEngine } from './replay-transport';
import { SessionSurface, SURFACE_ANSWER_MS } from './surface';
import type { TransportItem } from './transport';

afterEach(() => {
  vi.useRealTimers();
});

const SURFACE_INIT = { ...INIT_RESPONSE, capabilities: ['ui_surface_v1'] };
const ROSTER = { panes: [{ id: 'mods-probe-pane', title: 'Probe pane', plugin: 'mods-probe' }], shown_id: 'mods-probe-pane', focused_id: null, focus_requested_id: null };

async function until(check: () => boolean, what: string, ms = 3_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const surfaceResponder = (init: Record<string, unknown> = SURFACE_INIT) =>
  handshakeResponder({
    initialize: () => ({ response: init }),
    ui_attach: () => ({ response: { surfaces: ['desktop'] } }),
    ui_panes: () => ({ response: ROSTER }),
    ui_detach: () => ({ response: { detached: true, surfaces: [] } }),
    end_session: () => ({}),
  });

const writtenSubtypes = (writes: StdinFrame[]) => writes.flatMap((w) => (w.type === 'control_request' ? [w.request.subtype] : []));

describe('the session attaches as the desktop surface (R2)', () => {
  it('attaches right after initialize when the answer advertises ui_surface_v1, reads the roster, and says so in its status', async () => {
    const { session, transport, events } = scriptedSession({ responder: surfaceResponder() });
    await session.start();
    expect(session.status().process).toBe('ready');
    expect(writtenSubtypes(transport.writes).slice(0, 3)).toEqual(['initialize', 'ui_attach', 'ui_panes']);
    expect(transport.requestsOf('ui_attach')[0]!.request).toEqual({
      subtype: 'ui_attach', surface: 'desktop', client_id: 'maws-main', viewport: { columns: 100, rows: 30, isFullscreen: true }, answers: ['ui_copy', 'ui_prompt_read', 'ui_prompt_fill', 'ui_prompt_suggest'],
    });
    expect(transport.requestsOf('ui_panes')[0]!.request).toEqual({ subtype: 'ui_panes', client_id: 'maws-main' });
    expect(session.status().uiSurface).toEqual({ clientId: 'maws-main' });
    // the roster read's answer is the graph's `plugin.panes`
    expect(events.filter((e) => e.kind === 'plugin.panes')).toMatchObject([{ panes: [{ id: 'mods-probe-pane', title: 'Probe pane', plugin: 'mods-probe', closeOnEscape: false, holdToasts: false, rows: null, columns: null }], shownId: 'mods-probe-pane', focusedId: null }]);
  });

  it('never attaches to an engine that does not advertise the protocol (2.1.283, or the rollout served off)', async () => {
    const { session, transport } = scriptedSession({ responder: surfaceResponder(INIT_RESPONSE) });
    await session.start();
    expect(session.status().process).toBe('ready');
    expect(writtenSubtypes(transport.writes)).not.toContain('ui_attach');
    expect(session.status().uiSurface).toBeUndefined();
  });

  it('a refused attach leaves the session ready and unattached, logged', async () => {
    const { session, transport, logs } = scriptedSession({ responder: { ...surfaceResponder(), ui_attach: () => ({ error: 'Unsupported control request subtype: ui_attach' }) } });
    await session.start();
    expect(session.status().process).toBe('ready');
    expect(writtenSubtypes(transport.writes)).not.toContain('ui_panes');
    expect(session.status().uiSurface).toBeUndefined();
    expect(logs.some((line) => line.includes('did not attach'))).toBe(true);
  });

  it('detaches before end_session when the session stops', async () => {
    const { session, transport } = scriptedSession({ responder: surfaceResponder() });
    await session.start();
    const stopping = session.stop('stop');
    await until(() => transport.requestsOf('end_session').length === 1, 'end_session');
    const order = writtenSubtypes(transport.writes);
    expect(order.indexOf('ui_detach')).toBeGreaterThan(-1);
    expect(order.indexOf('ui_detach')).toBeLessThan(order.indexOf('end_session'));
    expect(transport.requestsOf('ui_detach')[0]!.request).toEqual({ subtype: 'ui_detach', client_id: 'maws-main' });
    transport.exit(0);
    await stopping;
    expect(session.status().uiSurface).toBeUndefined();
  });

  it("holds the engine's requests for the renderer: a copy becomes plugin.ask, the renderer's answer is written once, another kind is refused", async () => {
    const { session, transport, events } = scriptedSession({ responder: surfaceResponder() });
    await session.start();
    // pass3/mods-surface-copy seq 19
    transport.push({ type: 'control_request', request_id: 'copy-1', request: { subtype: 'ui_copy', surface: 'desktop', client_id: 'maws-main', plugin: 'mods-probe', text: 'MODS_PROBE_COPY' } });
    await until(() => events.some((e) => e.kind === 'plugin.ask'), 'plugin.ask');
    expect(events.find((e) => e.kind === 'plugin.ask')).toMatchObject({ requestId: 'copy-1', ask: 'copy', plugin: 'mods-probe', text: 'MODS_PROBE_COPY', mode: null });
    await expect(session.answerSurface('copy-1' as RequestId, { ask: 'prompt_read', text: '', cursor: 0 })).rejects.toThrow(/cannot take a prompt_read answer/);
    expect(await session.answerSurface('copy-1' as RequestId, { ask: 'copy', copied: true })).toBe('delivered');
    expect(transport.writes.filter((w) => w.type === 'control_response')).toEqual([{ type: 'control_response', response: { subtype: 'success', request_id: 'copy-1', response: { copied: true } } }]);
    expect(await session.answerSurface('copy-1' as RequestId, { ask: 'copy', copied: true })).toBe('not_pending');
  });

  it('a fill, a read and a suggest become plugin.ask with what each carries (pass3/mods-surface-prompt-access seq 22, 27, 36)', async () => {
    const { session, transport, events } = scriptedSession({ responder: surfaceResponder() });
    await session.start();
    transport.push({ type: 'control_request', request_id: 'read-1', request: { subtype: 'ui_prompt_read', surface: 'desktop', client_id: 'maws-main' } });
    transport.push({ type: 'control_request', request_id: 'fill-1', request: { subtype: 'ui_prompt_fill', surface: 'desktop', client_id: 'maws-main', text: 'MODS_PROBE_FILL', mode: 'replace' } });
    transport.push({ type: 'control_request', request_id: 'suggest-1', request: { subtype: 'ui_prompt_suggest', surface: 'desktop', client_id: 'maws-main', text: 'MODS_PROBE_SUGGEST' } });
    await until(() => events.filter((e) => e.kind === 'plugin.ask').length === 3, 'three asks');
    expect(events.filter((e) => e.kind === 'plugin.ask').map((e) => ({ ...e }))).toMatchObject([
      { requestId: 'read-1', ask: 'prompt_read', text: null, mode: null },
      { requestId: 'fill-1', ask: 'prompt_fill', text: 'MODS_PROBE_FILL', mode: 'replace' },
      { requestId: 'suggest-1', ask: 'prompt_suggest', text: 'MODS_PROBE_SUGGEST', mode: null },
    ]);
    await session.answerSurface('read-1' as RequestId, { ask: 'prompt_read', text: 'MAWS draft', cursor: 10 });
    await session.answerSurface('fill-1' as RequestId, { ask: 'prompt_fill', filled: true });
    await session.answerSurface('suggest-1' as RequestId, { ask: 'prompt_suggest', shown: false });
    expect(transport.writes.filter((w) => w.type === 'control_response').map((w) => (w as { response: { response: unknown } }).response.response)).toEqual([{ text: 'MAWS draft', cursor: 10 }, { filled: true }, { shown: false }]);
  });
});

describe('SessionSurface refuses what no window answered', () => {
  it('answers the engine its own unanswered outcome just inside the 5 s, once, and a late renderer answer finds nothing pending', async () => {
    vi.useFakeTimers();
    const written: { requestId: RequestId; response: unknown }[] = [];
    const respond = async (requestId: RequestId, response: unknown) => void written.push({ requestId, response });
    const surface = new SessionSurface({ log: () => {}, touch: () => {} });
    const ask = (id: string, request: Record<string, unknown>): ControlRequestFrame => ({ type: 'control_request', request_id: id, request: request as ControlRequestFrame['request'] });
    surface.accept(ask('c', { subtype: 'ui_copy', text: 't' }), respond);
    surface.accept(ask('r', { subtype: 'ui_prompt_read' }), respond);
    surface.accept(ask('f', { subtype: 'ui_prompt_fill', text: 't' }), respond);
    surface.accept(ask('s', { subtype: 'ui_prompt_suggest', text: 't' }), respond);
    surface.accept(ask('x', { subtype: 'can_use_tool' }), respond); // not the surface's
    expect(SURFACE_ANSWER_MS).toBeLessThan(5_000);
    await vi.advanceTimersByTimeAsync(SURFACE_ANSWER_MS - 1);
    expect(written).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(written).toEqual([
      { requestId: 'c', response: { copied: false } },
      { requestId: 'r', response: { text: '', cursor: 0 } },
      { requestId: 'f', response: { filled: false } },
      { requestId: 's', response: { shown: false } },
    ]);
    expect(await surface.answer('c' as RequestId, { ask: 'copy', copied: true }, respond)).toBe('not_pending');
  });
});

describe('the X2 surface commands (R2)', () => {
  it('render, press, input, select, focus, scroll, panes, show, focus a pane, close and edit write the ui_* request with the attach address and answer in MAWS shapes', async () => {
    const answers: Record<string, unknown> = {
      ui_render: { tree: { type: 'Text', children: ['MODS_PROBE_MODE modes=0'] }, props: { modes: [] }, rewritten: false, hooked: true },
      ui_press: { handled: true, element: 'press' },
      ui_input: { handled: true, element: 'reply', value: 'hel' },
      ui_select: { handled: false },
      ui_focus: { moved: true, element: null },
      ui_scroll: { moved: true, offset: 13 },
      ui_pane_show: { shown_id: 'mods-probe-pane' },
      ui_pane_focus: { focused_id: null },
      ui_close: { closed: true },
      ui_prompt_edit: { text: 'MAWS draft', cursor: 10 },
    };
    const responder = { ...surfaceResponder(), ...Object.fromEntries(Object.entries(answers).map(([subtype, response]) => [subtype, () => ({ response })])) };
    const { session, transport } = scriptedSession({ responder });
    await session.start();
    const { registerEngineIpc } = await import('./ipc');
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    registerEngineIpc((name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>), () => {}, {
      userData: '/tmp/maws-r2-unused', replayEnabled: false, table: { get: () => session, list: () => [session], onBudget: () => {}, onDropped: () => {} } as never,
    });
    const call = (name: string, input: Record<string, unknown>) => handlers.get(name)!({ appSessionId: 'app-s', ...input });
    const last = (subtype: string) => transport.requestsOf(subtype).at(-1)!.request;

    expect(await call('session.ui.render', { component: 'SessionMode', instanceId: 'session-mode', props: { modes: [] }, viewport: { columns: 80, rows: 24, isFullscreen: true } })).toEqual({ tree: { type: 'Text', children: ['MODS_PROBE_MODE modes=0'] }, props: { modes: [] }, rewritten: false, hooked: true });
    expect(last('ui_render')).toEqual({ subtype: 'ui_render', surface: 'desktop', client_id: 'maws-main', component: 'SessionMode', instance_id: 'session-mode', props: { modes: [] }, viewport: { columns: 80, rows: 24, isFullscreen: true } });
    expect(await call('session.ui.press', { plugin: 'mods-probe', handle: 1, key: 'press' })).toEqual({ handled: true, element: 'press' });
    expect(last('ui_press')).toEqual({ subtype: 'ui_press', plugin: 'mods-probe', handle: 1, key: 'press', surface: 'desktop', client_id: 'maws-main' });
    expect(await call('session.ui.input', { plugin: 'mods-probe', handle: 7, kind: 'change', value: 'hel', key: 'reply', component: 'AbovePrompt', instanceId: 'above-prompt' })).toEqual({ handled: true, element: 'reply', value: 'hel' });
    expect(last('ui_input')).toEqual({ subtype: 'ui_input', plugin: 'mods-probe', handle: 7, kind: 'change', value: 'hel', key: 'reply', component: 'AbovePrompt', instance_id: 'above-prompt', surface: 'desktop', client_id: 'maws-main' });
    expect(await call('session.ui.select', { plugin: 'mods-probe', handle: 999999, value: 'one' })).toEqual({ handled: false, element: null, value: null });
    expect(await call('session.ui.focus', { component: 'Pane', instanceId: 'mods-probe-pane', isHeld: true, element: null, by: 'person' })).toEqual({ moved: true, element: null, deny: null });
    expect(last('ui_focus')).toEqual({ subtype: 'ui_focus', component: 'Pane', instance_id: 'mods-probe-pane', is_held: true, element: null, by: 'person', surface: 'desktop', client_id: 'maws-main' });
    expect(await call('session.ui.scroll', { component: 'Pane', instanceId: 'mods-probe-pane', offset: 16, by: -3, bodyRows: 4, contentRows: 20 })).toEqual({ moved: true, offset: 13, deny: null, followEnd: false });
    expect(last('ui_scroll')).toEqual({ subtype: 'ui_scroll', component: 'Pane', instance_id: 'mods-probe-pane', offset: 16, by: -3, body_rows: 4, content_rows: 20, surface: 'desktop', client_id: 'maws-main' });
    expect(await call('session.ui.panes', {})).toMatchObject({ panes: [{ id: 'mods-probe-pane' }], shownId: 'mods-probe-pane', focusedId: null, focusRequestedId: null });
    expect(await call('session.ui.paneShow', { id: 'mods-probe-pane' })).toEqual({ shownId: 'mods-probe-pane' });
    expect(await call('session.ui.paneFocus', { id: null })).toEqual({ focusedId: null });
    expect(last('ui_pane_focus')).toEqual({ subtype: 'ui_pane_focus', id: null, surface: 'desktop', client_id: 'maws-main' });
    expect(await call('session.ui.close', { id: 'mods-probe-pane' })).toEqual({ closed: true });
    expect(await call('session.ui.promptEdit', { text: 'MAWS draft', cursor: 10, by: 'person' })).toBeUndefined();
    expect(last('ui_prompt_edit')).toEqual({ subtype: 'ui_prompt_edit', text: 'MAWS draft', cursor: 10, by: 'person', surface: 'desktop', client_id: 'maws-main' });
  });

  it('every R2 command has a handler, an engine-host owner and one deadline shape, bounded but for the immediate answer', async () => {
    const { registerEngineIpc, R2_DEADLINE_SHAPES } = await import('./ipc');
    const { R2_SESSION_COMMANDS } = await import('@shared/ipc/schema/session');
    const { commands } = await import('@shared/ipc/schema');
    const handlers = new Set<string>();
    registerEngineIpc((name) => void handlers.add(name), () => {}, { userData: '/tmp/maws-r2-unused', replayEnabled: false });
    expect(Object.keys(R2_DEADLINE_SHAPES).sort()).toEqual([...R2_SESSION_COMMANDS].sort());
    for (const name of R2_SESSION_COMMANDS) {
      expect(handlers.has(name), name).toBe(true);
      expect(commands[name].owner).toBe('engine-host');
      expect(R2_DEADLINE_SHAPES[name]).toBe(name === 'session.ui.answer' ? 'immediate' : 'bounded');
    }
  });

  it('a session the engine never attached answers the typed internal error', async () => {
    const { session } = scriptedSession({ responder: surfaceResponder(INIT_RESPONSE) });
    await session.start();
    const { registerEngineIpc } = await import('./ipc');
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    registerEngineIpc((name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>), () => {}, {
      userData: '/tmp/maws-r2-unused', replayEnabled: false, table: { get: () => session, list: () => [session], onBudget: () => {}, onDropped: () => {} } as never,
    });
    await expect(handlers.get('session.ui.render')!({ appSessionId: 'app-s', component: 'AbovePrompt', instanceId: 'above-prompt', props: {} })).rejects.toThrow(/no engine surface/);
  });
});

describe("the app's replay answers the surface's reads from the fixture (R2)", () => {
  const fixture = loadJournal('pass3', 'mods-surface-render-sites');
  const request = (id: string, subtype: string, extra: Record<string, unknown> = {}) => ({ type: 'control_request', request_id: id, request: { subtype, ...extra } }) as StdinFrame;
  const responseFor = (items: TransportItem[], id: string) => items.find((i) => (i.frame as { response?: { request_id?: string } } | null)?.response?.request_id === id)?.frame as { response: { response: Record<string, unknown> } } | undefined;

  async function drain(transport: ReturnType<typeof replayEngine>, until: (items: TransportItem[]) => boolean): Promise<TransportItem[]> {
    const items: TransportItem[] = [];
    const iterator = transport.frames[Symbol.asyncIterator]();
    while (!until(items)) {
      const next = await iterator.next();
      if (next.done) break;
      items.push(next.value);
    }
    return items;
  }

  it('answers renders by component and instance in any order, never holding on them, and passes over their recorded rows', async () => {
    const transport = replayEngine(fixture, { prelude: handshakePrelude(), surfaceReads: true });
    const initialize = (fixture.find((r) => r.direction === 'out') as JournalRow).frame as StdinFrame;
    void transport.write(initialize); // matched once the iterator reaches its row
    // the renderer asks the hint before the band and the mode, as no recording ordered them
    await transport.write(request('mine-hint', 'ui_render', { component: 'PromptHint', instance_id: 'prompt-hint' }));
    await transport.write(request('mine-band', 'ui_render', { component: 'AbovePrompt', instance_id: 'above-prompt' }));
    await transport.write(request('mine-pane', 'ui_render', { component: 'Pane', instance_id: 'nobody-drew-this' }));
    await transport.write(request('mine-attach', 'ui_attach', { surface: 'desktop', client_id: 'maws-main' }));
    const heldAt = () => (transport.holding?.frame as { type?: string } | undefined)?.type;
    const items = await drain(transport, (seen) => ['mine-hint', 'mine-band', 'mine-pane', 'mine-attach'].every((id) => responseFor(seen, id)) && heldAt() === 'user');
    expect(JSON.stringify(responseFor(items, 'mine-hint')!.response.response.tree)).toContain('MODS_PROBE_HINT');
    expect(JSON.stringify(responseFor(items, 'mine-band')!.response.response.tree)).toContain('MODS_PROBE_BAND presses=0');
    expect(responseFor(items, 'mine-pane')!.response.response).toEqual({}); // nothing recorded for that instance
    expect(items.some((i) => i.error?.kind === 'replay_unrecorded_read')).toBe(true);
    expect(responseFor(items, 'mine-attach')!.response.response).toEqual({ surfaces: ['desktop'] });
    // the next held row is the prompt, not a recorded render: the recorded reads were passed over, the push between
    // them delivered (pass3/mods-surface-render-sites seq 12)
    expect(heldAt()).toBe('user');
    expect(items.some((i) => (i.frame as { subtype?: string } | null)?.subtype === 'ui_panes')).toBe(true);
    transport.kill('SIGTERM');
  });

  it('without the option (the conformance harness) a render is matched and held in recorded order', async () => {
    const transport = replayEngine(fixture, { prelude: handshakePrelude() });
    const initialize = (fixture.find((r) => r.direction === 'out') as JournalRow).frame as StdinFrame;
    void transport.write(initialize);
    await drain(transport, () => transport.holding !== null && (transport.holding.frame as { request?: { subtype?: string } }).request?.subtype === 'ui_attach');
    expect((transport.holding!.frame as { request: { subtype: string } }).request.subtype).toBe('ui_attach');
    transport.kill('SIGTERM');
  });
});
