// @vitest-environment happy-dom
// The composers on a phone (mockups/desk/05-phone.html, 4–5): Return makes a new line and posting is the button, while
// a desk keeps Return to post; the group composer completes an @-tag from the project's live members. A slash in a
// session's composer is a command where the session can take one (the desk control surface's M0), and its status.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore } from 'zustand/vanilla';
import { RPC_FRESHNESS_MS } from 'desk-hub/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogs, catalogKey } from '../../state/catalog';
import { pendingCommands } from '../../state/pending-commands';
import fixture from '../../../../desk-hub/fake-machine/dx4/routes-2.1.307.json';
import type { Catalog } from 'desk-hub/protocol';
import { latency } from '../../latency/latency';
import type { ProjectConnection } from '../../project/connection';
import type { OpEntry } from '../../project/conversation';
import type { DeskSession } from '../../shell/sessions';
import { noteModel } from '../../state/models';
import { DeskContext } from '../conversation/desk-context';
import { CommandStatus } from './CommandStatus';
import { GroupComposer, SessionComposer } from './Composer';

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const S2 = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a';
const session = (id: string, alias: string, group: DeskSession['group'] = 'idle'): DeskSession => ({
  project: 'p1',
  session: id,
  alias,
  machine: 'mini',
  cwd: '/w',
  worktree: null,
  seat: '',
  title: null,
  member: true,
  ended: null,
  charge: null,
  status: null,
  state: null,
  joinedAt: 1,
  joinedTs: '',
  group,
  presence: { record: { status: 'idle' }, bridge: true },
  machineOnline: true,
});

let say: ReturnType<typeof vi.fn>;
let command: ReturnType<typeof vi.fn>;
function mount(ui: React.ReactNode, conversation: Record<string, unknown> = {}, live: Record<string, unknown> = {}, project = 'p1') {
  say = vi.fn(async () => 'nonce');
  command = vi.fn(async () => 'cmd-nonce');
  const store = <T,>(state: T) => createStore(() => state);
  const connection = { project, say, command, rpc: vi.fn(async () => 'nonce'), client: { reconnect: vi.fn() }, conversation: { store: store({ compactions: {}, rpcs: {}, ops: {}, ...conversation }) }, live: store({ connected: true, caughtUp: true, caughtUpAt: Date.now(), ...live }) } as unknown as ProjectConnection;
  const sessions = new Map([
    [S1, session(S1, 'maws-45')],
    [S2, session(S2, 'maws-fe', 'working')],
  ]);
  const wrap = (child: React.ReactNode) => <DeskContext.Provider value={{ connection, member: 'm1', sessions }}>{child}</DeskContext.Provider>;
  const view = render(wrap(ui));
  return { ...view, connection, redraw: (child: React.ReactNode) => view.rerender(wrap(child)) };
}

const phone = (narrow: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: narrow && query.includes('max-width'), addEventListener() {}, removeEventListener() {} }));

beforeEach(() => phone(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Return', () => {
  it('posts on a desk', () => {
    mount(<GroupComposer name="MAWS" />);
    const box = screen.getByRole('textbox', { name: 'Message #MAWS' });
    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(say).toHaveBeenCalledTimes(1);
  });

  it('makes a new line on a phone, in the group composer and in a session’s, and the button posts', () => {
    phone(true);
    mount(
      <>
        <GroupComposer name="MAWS" />
        <SessionComposer session={session(S1, 'maws-45')} />
      </>,
    );
    for (const name of ['Message #MAWS', 'Message maws-45']) {
      const box = screen.getByRole('textbox', { name });
      fireEvent.change(box, { target: { value: 'hello' } });
      const event = fireEvent.keyDown(box, { key: 'Enter' });
      expect(event).toBe(true); // not prevented: the browser inserts the newline
    }
    expect(say).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(say).toHaveBeenCalledTimes(1);
  });
});

describe('@ completion in the group composer', () => {
  it("lists the live members matching what follows @, and a pick inserts the tag say's grammar resolves", () => {
    phone(true);
    mount(<GroupComposer name="MAWS" />);
    const box = screen.getByRole('textbox', { name: 'Message #MAWS' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@maws-4', selectionStart: 7, selectionEnd: 7 } });
    const list = screen.getByRole('listbox', { name: 'Deliver to' });
    expect(list.textContent).toContain('maws-45');
    expect(list.textContent).not.toContain('maws-fe');
    fireEvent.mouseDown(screen.getByRole('option', { name: /maws-45/ }));
    expect(box.value).toBe('@maws-45 ');
    expect(screen.queryByRole('listbox', { name: 'Deliver to' })).toBeNull();
  });

  it('offers @all, and nothing once the text has moved past its opening tags', () => {
    mount(<GroupComposer name="MAWS" />);
    const box = screen.getByRole('textbox', { name: 'Message #MAWS' });
    fireEvent.change(box, { target: { value: '@a', selectionStart: 2, selectionEnd: 2 } });
    expect(screen.getByRole('option', { name: /@all/ })).toBeTruthy();
    fireEvent.change(box, { target: { value: 'thanks @ma', selectionStart: 10, selectionEnd: 10 } });
    expect(screen.queryByRole('listbox', { name: 'Deliver to' })).toBeNull();
  });
});

describe('the session composer’s hint', () => {
  it('names Enter as the steer only where Enter steers: on a desk, not on a phone', () => {
    const working = { ...session(S2, 'maws-fe', 'working'), presence: { record: { status: 'working' }, bridge: true } };
    mount(<SessionComposer session={working} />);
    expect(screen.getByRole('textbox', { name: 'Message maws-fe' }).getAttribute('placeholder')).toBe('Steer maws-fe (Enter), or Send to queue it');
    cleanup();
    phone(true);
    mount(<SessionComposer session={working} />);
    expect(screen.getByRole('textbox', { name: 'Message maws-fe' }).getAttribute('placeholder')).toBe('Steer maws-fe, or Send to queue it');
  });
});

describe('Model', () => {
  it("offers the session's own default and the ids the project's sessions were seen answering from, never a bare alias", () => {
    noteModel('p1', 'claude-fable-5-1');
    noteModel('p1', 'claude-opus-5-5');
    mount(<SessionComposer session={session(S1, 'maws-45')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    const input = screen.getByPlaceholderText('a model id, or default');
    const list = document.getElementById(input.getAttribute('list') ?? '');
    expect([...(list?.querySelectorAll('option') ?? [])].map((o) => o.value)).toEqual(['default', 'claude-opus-5-5', 'claude-fable-5-1']);
  });
});

// A slash typed in a session's composer (the desk control surface's M0): a command when the session and its machine
// can take one — the RPC `command`, its status drawn queued, ran, and read back — else refused in place with the
// capability's reason and a way to send it as words as before; a path is words.
describe('a slash command', () => {
  beforeEach(() => catalogs.accept(catalogKey('p1', S1), fixture.catalog as Catalog));
  const CAPS = { sminos: '1.8.0', protocol: 2, engine: '2.1.307', ops: ['read', 'command'], reads: ['status', 'catalog'], routes: { measured: '2.1.307' } };
  const capable = (status = 'idle'): DeskSession => ({ ...session(S1, 'maws-45'), presence: { record: { status }, bridge: true, capabilities: CAPS }, machineDesk: { sminos: '1.7.0', rpcs: ['command'], reads: [] } });
  const type = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Message maws-45' }), { target: { value: text } });

  it('runs a command the session can take on Send and on Enter, mid-turn too, never as words', async () => {
    mount(<SessionComposer session={capable()} />);
    type('/rename desk-m0');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(command).toHaveBeenCalledWith('m1', 'mini', S1, 'rename', 'desk-m0', false, undefined);
    expect(say).not.toHaveBeenCalled();
    cleanup();
    // Mid-turn Enter steers words, but a slash is a command, queued until the turn ends (H-queue).
    mount(<SessionComposer session={capable('busy')} />);
    type('/reload-plugins ');
    expect(screen.getByTestId('composer-note').textContent).toContain('a command is queued until maws-45 is idle');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message maws-45' }), { key: 'Enter' });
    expect(command).toHaveBeenCalledWith('m1', 'mini', S1, 'reload-plugins', '', true, undefined);
  });

  it("refuses a command the session cannot take in place, with the capability's reason, and sends it as words only when asked", () => {
    mount(<SessionComposer session={session(S1, 'maws-45')} />); // bridged, but its machine is older than M0
    type('/rename x');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(command).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    expect(screen.getByTestId('command-refused').textContent).toContain("mini's plugin is older than the desk's controls: update sminos on mini");
    fireEvent.click(screen.getByRole('button', { name: 'Send as text anyway' }));
    expect(say).toHaveBeenCalledWith('m1', [{ session: S1, alias: 'maws-45' }], '/rename x', false);
    expect(screen.queryByTestId('command-refused')).toBeNull();
  });

  it('sends a path or a lone slash as words', () => {
    mount(<SessionComposer session={capable()} />);
    type('/Users/new/notes.md is where it lives');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    type('/ that is all');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(command).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledTimes(2);
  });
});

describe('CommandStatus', () => {
  const rpc = (args: Record<string, unknown>) => ({ rpc: 'command', machine: 'mini', nonce: 'n1', args: { session: S1, ...args } });
  const draw = (conversation: Record<string, unknown>, running = false, outlives?: string) => {
    mount(<CommandStatus nonce="n1" outlives={outlives} session={{ ...session(S1, 'maws-45'), presence: { record: { status: running ? 'busy' : 'idle' }, bridge: true } }} />, conversation);
    return screen.getByTestId('command-status');
  };
  const queued = { state: 'done', outcome: { state: 'done', result: { queued: true, route: 'run', id: 'c1' } } };

  it('draws queued — until the session is idle, mid-turn — then ran with the line read back and its mark', () => {
    expect(draw({ rpcs: { n1: { ...queued, nonce: 'n1', rpc: rpc({ name: 'rename', args: 'desk-m0' }) } } }).textContent).toBe('Queued');
    cleanup();
    expect(draw({ rpcs: { n1: { ...queued, nonce: 'n1', rpc: rpc({ name: 'rename', args: 'desk-m0' }) } }, ops: { n1: { op: 'command', phase: 'start', session: S1, body: {} } } }, true).textContent).toBe('Queued until maws-45 is idle');
    cleanup();
    const end = { op: 'command', phase: 'end', session: S1, body: { rpc: 'n1', op: 'command', phase: 'end', id: 'c1', name: 'rename', args: 'desk-m0', settled: { ok: true }, readback: { how: 'row', text: 'Session renamed to: desk-m0', uuid: 'u1' } } };
    const ran = draw({ rpcs: { n1: { ...queued, nonce: 'n1', rpc: rpc({ name: 'rename', args: 'desk-m0' }) } }, ops: { n1: end } });
    expect(ran.getAttribute('data-command-state')).toBe('ran');
    expect(ran.textContent).toBe('Ran · Session renamed to: desk-m0 · confirmed by its row');
  });

  it("names what outlives the session, an unconfirmed run as such, and a refusal by the bridge's reason", () => {
    const end = (body: Record<string, unknown>) => ({ op: 'command', phase: 'end', session: S1, body: { rpc: 'n1', op: 'command', phase: 'end', id: 'c1', ...body } });
    const mcp = draw({ rpcs: { n1: { ...queued, nonce: 'n1', rpc: rpc({ name: 'mcp', args: 'disable github' }) } }, ops: { n1: end({ name: 'mcp', args: 'disable github', settled: { ok: true }, readback: { how: 'row', text: 'MCP server "github" disabled' } }) } }, false, 'saved for this project on mini: .claude.json');
    expect(mcp.textContent).toBe('Ran · MCP server "github" disabled · confirmed by its row · saved for this project on mini: .claude.json');
    cleanup();
    const none = draw({ rpcs: { n1: { ...queued, nonce: 'n1', rpc: rpc({ name: 'color', args: 'red' }) } }, ops: { n1: end({ name: 'color', args: 'red', settled: { ok: true }, readback: { how: 'none' } }) } });
    expect(none.getAttribute('data-command-state')).toBe('unconfirmed');
    expect(none.textContent).toBe('Ran, unconfirmed');
    cleanup();
    const refused = draw({ rpcs: { n1: { nonce: 'n1', rpc: rpc({ name: 'usage' }), state: 'failed', outcome: { state: 'failed', error: { code: 'failed', message: "panel: opens a panel in the terminal; it would hold the session's queue" } } } } });
    expect(refused.getAttribute('data-command-state')).toBe('refused');
    expect(refused.textContent).toBe("/usage: opens a panel in the terminal; it would hold the session's queue");
  });

  it("marks its readback drawn (latency's op.readback) once it draws the op's end, and not before", () => {
    const drawn = vi.spyOn(latency, 'commandDrawn');
    draw({ rpcs: { n1: { ...queued, nonce: 'n1', rpc: rpc({ name: 'rename', args: 'x' }) } }, ops: { n1: { op: 'command', phase: 'start', session: S1, body: {} } } });
    expect(drawn).not.toHaveBeenCalled();
    cleanup();
    const end = { op: 'command', phase: 'end', session: S1, body: { rpc: 'n1', op: 'command', phase: 'end', id: 'c1', name: 'rename', args: 'x', settled: { ok: true }, readback: { how: 'row', text: 'Session renamed to: x' } } };
    draw({ rpcs: { n1: { ...queued, nonce: 'n1', rpc: rpc({ name: 'rename', args: 'x' }) } }, ops: { n1: end } });
    expect(drawn).toHaveBeenCalledExactlyOnceWith('n1');
    drawn.mockRestore();
  });

  it("leaves the RPC's own states to RpcStatus while it is on its way", () => {
    mount(<CommandStatus nonce="n1" session={session(S1, 'maws-45')} />, { rpcs: { n1: { nonce: 'n1', rpc: rpc({ name: 'rename', args: 'x' }), state: 'forwarded' } } });
    expect(screen.getByRole('status').getAttribute('data-rpc-state')).toBe('forwarded');
  });
});


describe('the cached command palette', () => {
  const capable: DeskSession = { ...session(S1, 'maws-45'), presence: { record: { status: 'idle' }, bridge: true,
    capabilities: { sminos: '1.8.0', protocol: 2, engine: '2.1.307', ops: ['command', 'read'], reads: ['status', 'catalog'], routes: { measured: '2.1.307' } } }, machineDesk: { sminos: '1.8.0', rpcs: ['command'], reads: [] } };
  const type = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Message maws-45' }), { target: { value } });
  beforeEach(() => catalogs.accept(catalogKey('p1', S1), fixture.catalog as Catalog));
  it('draws slash choices without fetching, inserts the selected command, then routes Send', () => {
    mount(<SessionComposer session={capable} />);
    type('/col');
    const row = screen.getByRole('option', { name: /color/ });
    fireEvent.mouseDown(row);
    expect((screen.getByRole('textbox', { name: 'Message maws-45' }) as HTMLTextAreaElement).value).toBe('/color ');
    type('/color red');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(command).toHaveBeenCalledWith('m1', 'mini', S1, 'color', 'red', false, undefined);
    expect(say).not.toHaveBeenCalled();
  });
  it('refuses an unknown or a terminal panel before RPC and opens existing Model locally', () => {
    mount(<SessionComposer session={capable} />);
    type('/bogus');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByTestId('command-refused').textContent).toContain('not a command this session knows');
    type('/usage');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByTestId('command-refused').textContent).toContain('panel');
    type('/model');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('form', { name: 'Model and effort' })).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
  });
  it('requires confirmation for an advertised confirm route and never runs a disabled item from the keyboard', () => {
    const offered = structuredClone(fixture.catalog) as Catalog;
    const exit = offered.commands.find((c) => c.name === 'exit')!;
    exit.route.enabled = true;
    catalogs.accept(catalogKey('p1', S1), offered);
    mount(<SessionComposer session={capable} />);
    type('/exit'); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('mini');
    expect(command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run command' }));
    expect(command).toHaveBeenCalledTimes(1);
    type('/usage');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message maws-45' }), { key: 'Enter' });
    expect(command).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('listbox', { name: 'Commands' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message maws-45' }), { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull();
  });

  it('keeps two back-to-back command statuses rather than replacing the first nonce', async () => {
    mount(<SessionComposer session={capable} />);
    command.mockResolvedValueOnce('one').mockResolvedValueOnce('two');
    type('/color red'); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    type('/color blue'); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await vi.waitFor(() => expect(screen.getAllByTestId('command-receipt')).toHaveLength(2));
  });
});

describe('typeahead version guidance', () => {
  function open(machineVersion?: string) {
    mount(<SessionComposer session={{ ...session(S1, 'maws-45'), machineDesk: machineVersion ? { sminos: machineVersion, rpcs: ['command'], reads: [] } : undefined }} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message maws-45' }), { target: { value: '/', selectionStart: 1 } });
  }
  it('asks an older machine to update sminos and states the required version', () => {
    open('1.7.1');
    expect(screen.getByText(/commands need sminos/).textContent).toContain('commands need sminos ≥ 1.8.0 on mini');
    expect(screen.getByText(/commands need sminos/).textContent).toContain('update sminos on mini');
  });
  it('asks only to reload a stale session on an already updated machine', () => {
    open('1.8.0');
    expect(screen.getByText(/this session's plugin loaded before the update/, { selector: 'p' }).textContent).toContain("this session's plugin loaded before the update: run /reload-plugins in it, or restart it");
    expect(screen.queryByText(/commands need sminos/)).toBeNull();
  });
});

describe('unseen receipts across a reopened session or fresh page', () => {
  const end: OpEntry = { op: 'command', phase: 'end', session: S1, body: { rpc: 'own-op', op: 'command', phase: 'end', id: 'c1', name: 'color', args: 'orange', settled: { ok: true }, readback: { how: 'row', text: 'Session color set to: orange', uuid: 'color-row' } } };
  beforeEach(() => {
    localStorage.clear();
    // happy-dom has no layout. Browser e2e exercises actual clipping; this boundary says the mounted line is in view.
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) { queueMicrotask(() => this.callback([{ target, isIntersecting: true, intersectionRatio: 1, time: 0, boundingClientRect: new DOMRect(), intersectionRect: new DOMRect(), rootBounds: null }], this as unknown as IntersectionObserver)); }
      disconnect() {}
    });
  });
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('renders our unseen replay without the old RPC, and acknowledges it only while actually visible', async () => {
    pendingCommands.remember({ project: 'p1', machine: 'mini', session: S1, nonce: 'own-op', name: 'color' });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    mount(<SessionComposer session={session(S1, 'maws-45')} />, { ops: { 'own-op': end } });
    expect(screen.getByTestId('command-status').textContent).toBe('Ran · Session color set to: orange · confirmed by its row');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(pendingCommands.pending('p1', 'mini', S1)).toHaveLength(1);
    cleanup(); // A closed view does not own the pending receipt.
    visibility.mockReturnValue('visible');
    mount(<SessionComposer session={session(S1, 'maws-45')} />, { ops: { 'own-op': end } });
    expect(screen.getByTestId('command-status').textContent).toBe('Ran · Session color set to: orange · confirmed by its row');
    await waitFor(() => expect(pendingCommands.pending('p1', 'mini', S1)).toEqual([]));
    expect(screen.getByTestId('command-status')).toBeTruthy(); // Acknowledgement never makes the line vanish while read.
    cleanup();
    mount(<SessionComposer session={session(S1, 'maws-45')} />, { ops: { 'own-op': end } });
    expect(screen.queryByTestId('command-status')).toBeNull(); // A later view is not a command-history dump.
  });

  it('settles an old missing receipt only after join replay, acknowledges it when visible, and accepts a late real end', async () => {
    pendingCommands.remember({ project: 'p1', machine: 'mini', session: S1, nonce: 'own-op', name: 'color' });
    const saved = JSON.parse(localStorage.getItem('desk.pending-commands')!);
    saved[0].at -= RPC_FRESHNESS_MS + 1;
    localStorage.setItem('desk.pending-commands', JSON.stringify(saved));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { connection } = mount(<SessionComposer session={session(S1, 'maws-45')} />, {}, { connected: false, caughtUp: true, caughtUpAt: null });
    expect(screen.getByTestId('command-status').getAttribute('data-command-state')).toBe('checking');
    expect(pendingCommands.pending('p1', 'mini', S1)).toHaveLength(1);
    act(() => connection.live.setState({ connected: true, caughtUp: false }));
    expect(screen.getByTestId('command-status').getAttribute('data-command-state')).toBe('checking');
    act(() => connection.live.setState({ caughtUp: true, caughtUpAt: Date.now() }));
    expect(screen.getByTestId('command-status').getAttribute('data-command-state')).toBe('unknown');
    expect(screen.getByTestId('command-status').textContent).toMatch(/may not have run.*check the session/i);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(pendingCommands.pending('p1', 'mini', S1)).toHaveLength(1);
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(pendingCommands.pending('p1', 'mini', S1)).toEqual([]));
    act(() => connection.conversation.store.setState({ ops: { 'own-op': end } }));
    expect(screen.getByTestId('command-status').textContent).toBe('Ran · Session color set to: orange · confirmed by its row');
    expect(command).not.toHaveBeenCalled();
    expect(connection.client.reconnect).not.toHaveBeenCalled();
    cleanup();
    mount(<SessionComposer session={session(S1, 'maws-45')} />);
    expect(screen.queryByTestId('command-status')).toBeNull();
  });

  it('keeps a live in-memory RPC pending even when its saved ownership is old and join replay is complete', () => {
    pendingCommands.remember({ project: 'p1', machine: 'mini', session: S1, nonce: 'own-op', name: 'color' });
    const saved = JSON.parse(localStorage.getItem('desk.pending-commands')!);
    saved[0].at -= RPC_FRESHNESS_MS + 1;
    localStorage.setItem('desk.pending-commands', JSON.stringify(saved));
    mount(<SessionComposer session={session(S1, 'maws-45')} />, { rpcs: { 'own-op': { nonce: 'own-op', state: 'forwarded', rpc: { rpc: 'command', machine: 'mini', args: { session: S1, name: 'color', args: 'orange' } } } } });
    expect(screen.getByRole('status').getAttribute('data-rpc-state')).toBe('forwarded');
    expect(pendingCommands.pending('p1', 'mini', S1)).toHaveLength(1);
  });

  it('gives a fresh in-flight command its freshness window, rechecks once while visible, and preserves a replayed start', async () => {
    vi.useFakeTimers();
    try {
      pendingCommands.remember({ project: 'p1', machine: 'mini', session: S1, nonce: 'own-op', name: 'color' });
      vi.advanceTimersByTime(1000);
      pendingCommands.remember({ project: 'p1', machine: 'mini', session: S1, nonce: 'second-op', name: 'color' });
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      const { connection, redraw } = mount(<SessionComposer session={session(S1, 'maws-45')} />);
      const reconnect = vi.mocked(connection.client.reconnect).mockImplementation(() => connection.live.setState({ connected: false }));
      expect(screen.getAllByTestId('command-status').map((line) => line.getAttribute('data-command-state'))).toEqual(['checking', 'checking']);
      await act(() => vi.advanceTimersByTimeAsync(RPC_FRESHNESS_MS - 999));
      expect(reconnect).not.toHaveBeenCalled();
      visibility.mockReturnValue('visible');
      act(() => fireEvent(document, new Event('visibilitychange')));
      expect(reconnect).not.toHaveBeenCalled(); // One join must wait for the newer nonce's freshness too.
      visibility.mockReturnValue('hidden');
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(reconnect).not.toHaveBeenCalled(); // Expiry alone never rotates a hidden page.
      visibility.mockReturnValue('visible');
      act(() => fireEvent(document, new Event('visibilitychange')));
      expect(reconnect).toHaveBeenCalledTimes(1); // The batch rotates once, not once per missing nonce.
      expect(screen.getAllByTestId('command-status').map((line) => line.getAttribute('data-command-state'))).toEqual(['checking', 'checking']);
      act(() => {
        connection.conversation.store.setState({ ops: { 'own-op': { ...end, phase: 'start', body: { ...end.body, phase: 'start' } } } });
        connection.live.setState({ connected: true, caughtUp: true, caughtUpAt: Date.now() });
      });
      expect(screen.getAllByTestId('command-status').map((line) => line.getAttribute('data-command-state'))).toEqual(['queued', 'unknown']);
      expect(pendingCommands.pending('p1', 'mini', S1).some((row) => row.nonce === 'own-op')).toBe(true);
      act(() => connection.conversation.store.setState({ ops: { 'own-op': end } }));
      expect(screen.getAllByTestId('command-status')[0].textContent).toBe('Ran · Session color set to: orange · confirmed by its row');
      await act(() => vi.advanceTimersByTimeAsync(RPC_FRESHNESS_MS + 1));
      expect(reconnect).toHaveBeenCalledTimes(1);
      expect(command).not.toHaveBeenCalled();

      // Another restored batch in this same connection still gets its own one-shot post-expiry replay.
      pendingCommands.remember({ project: 'p1', machine: 'mini', session: S1, nonce: 'later-op', name: 'color' });
      redraw(<SessionComposer key="later-batch" session={session(S1, 'maws-45')} />);
      await act(() => vi.advanceTimersByTimeAsync(RPC_FRESHNESS_MS + 1));
      expect(reconnect).toHaveBeenCalledTimes(2);
      act(() => connection.live.setState({ connected: true, caughtUp: true, caughtUpAt: Date.now() }));
      expect(screen.getByTestId('command-status').getAttribute('data-command-state')).toBe('unknown');
      cleanup();

      // Nor can this project's replay suppress another project's recovered receipt.
      pendingCommands.remember({ project: 'p2', machine: 'mini', session: S1, nonce: 'other-project-op', name: 'color' });
      const other = mount(<SessionComposer session={{ ...session(S1, 'other-project'), project: 'p2' }} />, {}, {}, 'p2').connection;
      vi.mocked(other.client.reconnect).mockImplementation(() => other.live.setState({ connected: false }));
      await act(() => vi.advanceTimersByTimeAsync(RPC_FRESHNESS_MS + 1));
      expect(other.client.reconnect).toHaveBeenCalledTimes(1);
      act(() => other.live.setState({ connected: true, caughtUp: true, caughtUpAt: Date.now() }));
      expect(screen.getByTestId('command-status').getAttribute('data-command-state')).toBe('unknown');
      await act(() => vi.advanceTimersByTimeAsync(RPC_FRESHNESS_MS + 1));
      expect(other.client.reconnect).toHaveBeenCalledTimes(1);
    } finally { cleanup(); vi.useRealTimers(); }
  });

  it('never renders stale hub-replayed commands this browser did not send', () => {
    mount(<SessionComposer session={session(S1, 'maws-45')} />, { ops: { 'someone-else': { ...end, body: { ...end.body, rpc: 'someone-else' } } } });
    expect(screen.queryByLabelText('Command outcomes')).toBeNull();
  });
});
