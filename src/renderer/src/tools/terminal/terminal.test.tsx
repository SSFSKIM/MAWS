// The Terminal tool against a mocked registry (C9 M4 unit pins): the state factory, the close veto, the attach entry
// point, and the view's mount, worktree warning, title suffix, lifecycle bars and context menu.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { HostState } from '@shared/ipc/schema';
import { mountPanelHost, type PanelHostImplementation } from '../../panel/host';
import type { PanelToolContext } from '../../panel/tool';
import type { TerminalInfo } from '../../terminal/registry';

const registry = vi.hoisted(() => {
  type Listener = (infos: TerminalInfo[], host: HostState | null) => void;
  const listeners = new Set<Listener>();
  let infos: TerminalInfo[] = [];
  let host: HostState | null = { state: 'ready', pid: 1, restarts: 0, revision: 1 };
  const renderer = { getSelection: vi.fn(() => 'picked'), hasSelection: vi.fn(() => true), selectAll: vi.fn(), clear: vi.fn(), paste: vi.fn() };
  const publish = () => listeners.forEach((cb) => cb(infos, host));
  let next = 0;
  return {
    renderer,
    reset() {
      infos = [];
      host = { state: 'ready', pid: 1, restarts: 0, revision: 1 };
      next = 0;
    },
    patch(id: string, patch: Partial<TerminalInfo>) {
      infos = infos.map((info) => (info.id === id ? { ...info, ...patch } : info));
      publish();
    },
    setHost(state: HostState) {
      host = state;
      publish();
    },
    terminals: {
      list: () => infos,
      host: () => host,
      subscribe(cb: Listener) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      open: vi.fn((init: { appSessionId: string; label: string; cwd: string; command?: string }) => {
        const id = `t${++next}`;
        infos = [
          ...infos,
          {
            id,
            appSessionId: init.appSessionId,
            label: init.label,
            cwd: init.cwd,
            ptyId: null,
            pid: null,
            status: 'running',
            exit: null,
            title: null,
            acceleration: 'webgl',
            visible: false,
            reconnect: null,
            error: null,
          } as unknown as TerminalInfo,
        ];
        publish();
        return id;
      }),
      get: vi.fn((id: string) => {
        const info = infos.find((i) => i.id === id);
        return info ? { info, renderer, container: document.createElement('div') } : undefined;
      }),
      mount: vi.fn(),
      unmount: vi.fn(),
      focus: vi.fn(),
      foreground: vi.fn(async () => ({ process: 'zsh', busy: false })),
      close: vi.fn(async () => {}),
      respawn: vi.fn(async () => {}),
    },
  };
});

vi.mock('../../terminal/registry', () => ({ terminals: registry.terminals }));

const { openTerminal, terminalTool, TERMINAL_TOOL_ID } = await import('./index');

const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;

function session(appId: AppSessionId, directory: string, worktree: string | null = null): SessionRecord {
  return { appId, directory, worktree: worktree ? { path: worktree, branch: 'harness' } : null } as SessionRecord;
}
const SESSION_A = session(A, '/tmp/maws-harness/a');
const SESSION_B = session(B, '/repo', '/tmp/maws-harness/b');

function context(overrides: Partial<PanelToolContext> = {}): PanelToolContext {
  return {
    appSessionId: A,
    session: SESSION_A,
    status: null,
    pinned: false,
    visible: true,
    focusRequest: 0,
    setTitle: vi.fn(),
    close: vi.fn(),
    openTool: vi.fn(() => 'terminal:new'),
    ...overrides,
  };
}

function newState(init: { session?: SessionRecord | null; params?: { cwd?: string; command?: string }; instanceId?: string } = {}) {
  return terminalTool.createState({ appSessionId: A, session: init.session === undefined ? SESSION_A : init.session, instanceId: init.instanceId ?? 'terminal:1', params: init.params ?? {} });
}

const View = terminalTool.render;

beforeEach(() => {
  registry.reset();
  vi.clearAllMocks();
  // clearAllMocks keeps implementations a test replaced; every test starts from an idle shell and a close that works
  registry.terminals.foreground.mockImplementation(async () => ({ process: 'zsh', busy: false }));
  registry.terminals.close.mockImplementation(async () => {});
});
afterEach(() => cleanup());

describe('terminal tool state', () => {
  it('opens a terminal labelled with the tab id in params.cwd, else the session worktree, else its directory', () => {
    newState({ params: { cwd: '/elsewhere', command: 'claude --bg attach 1' } });
    newState({ session: SESSION_B, instanceId: 'terminal:2' });
    newState({ instanceId: 'terminal:3' });
    expect(registry.terminals.open.mock.calls.map(([init]) => init)).toEqual([
      { appSessionId: A, label: 'terminal:1', cwd: '/elsewhere', command: 'claude --bg attach 1' },
      { appSessionId: A, label: 'terminal:2', cwd: '/tmp/maws-harness/b' },
      { appSessionId: A, label: 'terminal:3', cwd: '/tmp/maws-harness/a' },
    ]);
  });

  it('takes over a re-adopted terminal whose label is the tab id instead of opening another', () => {
    const adopted = registry.terminals.open({ appSessionId: B, label: 'terminal:9', cwd: '/tmp/maws-harness/b' });
    registry.terminals.open.mockClear();
    expect(newState({ instanceId: 'terminal:9' }).terminalId).toBe(adopted);
    expect(registry.terminals.open).not.toHaveBeenCalled();
  });

  it('defers the terminal of a tab created with no session (a pinned tab restored on Overview) instead of throwing', () => {
    const state = terminalTool.createState({ appSessionId: null, session: null, instanceId: 'terminal:1', params: {} });
    expect(state.terminalId).toBeNull();
    expect(registry.terminals.open).not.toHaveBeenCalled();
  });

  it('completes a deferred terminal through open() once it has a directory', () => {
    const state = terminalTool.createState({ appSessionId: A, session: null, instanceId: 'terminal:1', params: {} });
    expect(state.terminalId).toBeNull();
    terminalTool.open!(state, { cwd: '/elsewhere', command: 'claude --bg attach 1' });
    expect(registry.terminals.open).toHaveBeenCalledWith({ appSessionId: A, label: 'terminal:1', cwd: '/elsewhere', command: 'claude --bg attach 1' });
    expect(state.terminalId).toBe('t1');
  });

  it('is the multi-instance, pinnable tool with id terminal', () => {
    expect(terminalTool).toMatchObject({ id: TERMINAL_TOOL_ID, title: 'Terminal', pinnable: true, multiInstance: true });
    expect(TERMINAL_TOOL_ID).toBe('terminal');
  });
});

describe('terminal tool close', () => {
  it('closes an idle terminal without asking, killing its shell before the tab goes', async () => {
    const state = newState();
    await expect(terminalTool.beforeClose(state)).resolves.toBe(true);
    expect(state.ui.getState().confirmClose).toBe(false);
    expect(registry.terminals.close).toHaveBeenCalledWith(state.terminalId);
  });

  it('vetoes and asks when the registry reports a command running, killing nothing', async () => {
    const state = newState();
    registry.terminals.foreground.mockResolvedValueOnce({ process: 'sleep', busy: true });
    await expect(terminalTool.beforeClose(state)).resolves.toBe(false);
    expect(state.ui.getState()).toMatchObject({ confirmClose: true, process: 'sleep' });
    expect(registry.terminals.close).not.toHaveBeenCalled();
  });

  it('fails closed and asks when the host cannot say what runs', async () => {
    const state = newState();
    registry.terminals.foreground.mockRejectedValueOnce(new Error('pty.foreground failed: host_unavailable'));
    await expect(terminalTool.beforeClose(state)).resolves.toBe(false);
    expect(state.ui.getState()).toMatchObject({ confirmClose: true, process: null });
  });

  it('does not ask for a terminal that no longer runs, nor after the owner confirmed, and closes both', async () => {
    const exited = newState();
    registry.patch(exited.terminalId!, { status: 'exited' });
    await expect(terminalTool.beforeClose(exited)).resolves.toBe(true);
    const confirmed = newState({ instanceId: 'terminal:2' });
    confirmed.ui.setState({ confirmed: true });
    await expect(terminalTool.beforeClose(confirmed)).resolves.toBe(true);
    expect(registry.terminals.foreground).not.toHaveBeenCalled();
    expect(registry.terminals.close.mock.calls).toEqual([[exited.terminalId], [confirmed.terminalId]]);
  });

  it('keeps the tab with the reason when the kill fails, and lets it go when a retry succeeds', async () => {
    const state = newState();
    registry.terminals.close.mockRejectedValueOnce(new Error('pty.kill failed: EPERM'));
    await expect(terminalTool.beforeClose(state)).resolves.toBe(false);
    expect(state.ui.getState().closeError).toBe('pty.kill failed: EPERM');
    await expect(terminalTool.beforeClose(state)).resolves.toBe(true);
    expect(state.ui.getState().closeError).toBeNull();
    expect(registry.terminals.close).toHaveBeenCalledTimes(2);
  });

  it('never kills on dispose (the close already did)', () => {
    const state = newState();
    terminalTool.dispose(state);
    expect(registry.terminals.close).not.toHaveBeenCalled();
  });
});

describe('openTerminal', () => {
  it('asks the panel host for a Terminal tab with the cwd and command as params', () => {
    const host: PanelHostImplementation = { addTool: vi.fn(() => 'terminal:7'), selectTab: vi.fn(), closeTab: vi.fn(async () => true), showSummary: vi.fn(), closeToolTabs: vi.fn() };
    const unmount = mountPanelHost(host);
    try {
      expect(openTerminal({ appSessionId: A, cwd: '/tmp/maws-harness/a', command: 'printf MAWS_ATTACH_OK\\n' })).toBe('terminal:7');
      expect(host.addTool).toHaveBeenCalledWith('terminal', { appSessionId: A, params: { cwd: '/tmp/maws-harness/a', command: 'printf MAWS_ATTACH_OK\\n' } });
    } finally {
      unmount();
    }
  });
});

describe('terminal view', () => {
  it('mounts the terminal’s container while visible without taking focus, focuses on request, and detaches on unmount', () => {
    const state = newState();
    const { rerender, unmount } = render(<View state={state} ctx={context()} />);
    expect(registry.terminals.mount).toHaveBeenCalledWith(state.terminalId, expect.any(HTMLElement));
    expect(registry.terminals.focus).not.toHaveBeenCalled();
    rerender(<View state={state} ctx={context({ focusRequest: 1 })} />);
    expect(registry.terminals.focus).toHaveBeenCalledWith(state.terminalId);
    unmount();
    expect(registry.terminals.unmount).toHaveBeenCalledWith(state.terminalId);
  });

  it('asks for a session while it has none, and opens its terminal in the first session shown', () => {
    const state = terminalTool.createState({ appSessionId: null, session: null, instanceId: 'terminal:5', params: {} });
    const { rerender } = render(<View state={state} ctx={context({ appSessionId: null, session: null })} />);
    expect(screen.getByRole('status', { name: 'terminal pending' }).textContent).toBe('Open a session to start a terminal');
    expect(registry.terminals.mount).not.toHaveBeenCalled();
    rerender(<View state={state} ctx={context({ appSessionId: B, session: SESSION_B })} />);
    expect(registry.terminals.open).toHaveBeenCalledWith({ appSessionId: B, label: 'terminal:5', cwd: '/tmp/maws-harness/b' });
    expect(state.terminalId).toBe('t1');
    expect(screen.queryByRole('status', { name: 'terminal pending' })).toBeNull();
    expect(registry.terminals.mount).toHaveBeenCalledWith('t1', expect.any(HTMLElement));
    rerender(<View state={state} ctx={context({ appSessionId: A, session: SESSION_A })} />);
    expect(registry.terminals.open).toHaveBeenCalledTimes(1);
  });

  it('closes a tab whose terminal never started without asking', async () => {
    const state = terminalTool.createState({ appSessionId: null, session: null, instanceId: 'terminal:6', params: {} });
    await expect(terminalTool.beforeClose(state)).resolves.toBe(true);
    expect(registry.terminals.close).not.toHaveBeenCalled();
  });

  it('warns exactly when the shown session runs somewhere other than the terminal’s cwd, and offers a new terminal there', () => {
    const state = newState();
    const ctx = context({ appSessionId: B, session: SESSION_B, pinned: true });
    const { rerender } = render(<View state={state} ctx={ctx} />);
    const warning = screen.getByRole('status', { name: 'worktree warning' });
    expect(warning.textContent).toBe('This terminal is in /tmp/maws-harness/a; the session now runs in /tmp/maws-harness/b.New terminal here');
    fireEvent.click(screen.getByRole('button', { name: 'New terminal here' }));
    expect(ctx.openTool).toHaveBeenCalledWith('terminal', { appSessionId: B, params: { cwd: '/tmp/maws-harness/b' } });
    rerender(<View state={state} ctx={context()} />);
    expect(screen.queryByRole('status', { name: 'worktree warning' })).toBeNull();
    rerender(<View state={state} ctx={context({ appSessionId: null, session: null })} />);
    expect(screen.queryByRole('status', { name: 'worktree warning' })).toBeNull();
  });

  it('sets the tab title suffix from the program’s title', () => {
    const state = newState();
    const ctx = context();
    render(<View state={state} ctx={ctx} />);
    expect(ctx.setTitle).toHaveBeenLastCalledWith(null);
    act(() => registry.patch(state.terminalId!, { title: 'vim notes.md' }));
    expect(ctx.setTitle).toHaveBeenLastCalledWith('vim notes.md');
  });

  it('shows an exited terminal’s code with New terminal and Close', () => {
    const state = newState();
    const ctx = context();
    render(<View state={state} ctx={ctx} />);
    act(() => registry.patch(state.terminalId!, { status: 'exited', exit: { exitCode: 1, signal: null } }));
    expect(screen.getByRole('status', { name: 'terminal status' }).textContent).toContain('Process exited (code 1)');
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }));
    expect(registry.terminals.respawn).toHaveBeenCalledWith(state.terminalId);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(ctx.close).toHaveBeenCalled();
  });

  it('says why a terminal could not start', () => {
    const state = newState();
    render(<View state={state} ctx={context()} />);
    act(() => registry.patch(state.terminalId!, { status: 'exited', exit: null, error: 'the shell could not start: posix_spawnp failed' }));
    expect(screen.getByRole('status', { name: 'terminal status' }).textContent).toContain('The shell could not start: posix_spawnp failed');
  });

  it('shows a lost terminal with New terminal disabled until the terminal service is ready', () => {
    const state = newState();
    render(<View state={state} ctx={context()} />);
    act(() => {
      registry.setHost({ state: 'restarting', pid: null, restarts: 1, revision: 2 });
      registry.patch(state.terminalId!, { status: 'lost', exit: { exitCode: null, signal: null } });
    });
    expect(screen.getByRole('status', { name: 'terminal status' }).textContent).toContain('Terminal lost, the terminal service restarted');
    expect((screen.getByRole('button', { name: 'New terminal' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => registry.setHost({ state: 'ready', pid: 2, restarts: 1, revision: 3 }));
    expect((screen.getByRole('button', { name: 'New terminal' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the lossy reconnect notice', () => {
    const state = newState();
    render(<View state={state} ctx={context()} />);
    act(() => registry.patch(state.terminalId!, { reconnect: 'lossy' }));
    expect(screen.getByRole('status', { name: 'reconnect notice' }).textContent).toBe('Reconnected; earlier output was not kept');
  });

  it('asks inline before closing a busy terminal: Keep dismisses, Close confirms and closes', async () => {
    const state = newState();
    const ctx = context();
    render(<View state={state} ctx={ctx} />);
    registry.terminals.foreground.mockResolvedValue({ process: 'sleep', busy: true });
    await act(async () => void (await terminalTool.beforeClose(state)));
    expect(screen.getByRole('alert', { name: 'close confirmation' }).textContent).toContain('A command is running: sleep. Close anyway?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByRole('alert', { name: 'close confirmation' })).toBeNull();
    await act(async () => void (await terminalTool.beforeClose(state)));
    fireEvent.click(within(screen.getByRole('alert', { name: 'close confirmation' })).getByRole('button', { name: 'Close' }));
    expect(state.ui.getState().confirmed).toBe(true);
    expect(ctx.close).toHaveBeenCalled();
  });

  it('shows a failed close with its reason and Close to retry', async () => {
    const state = newState();
    const ctx = context();
    render(<View state={state} ctx={ctx} />);
    registry.terminals.close.mockRejectedValueOnce(new Error('pty.kill failed: EPERM'));
    await act(async () => void (await terminalTool.beforeClose(state)));
    const alert = screen.getByRole('alert', { name: 'close failed' });
    expect(alert.textContent).toContain('Could not close: pty.kill failed: EPERM');
    fireEvent.click(within(alert).getByRole('button', { name: 'Close' }));
    expect(ctx.close).toHaveBeenCalled();
  });

  it('offers Copy, Paste, Select all and Clear from its context menu', async () => {
    const clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => 'from the clipboard') };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    const state = newState();
    render(<View state={state} ctx={context()} />);
    const open = () => fireEvent.contextMenu(screen.getByTestId('terminal-surface'), { clientX: 20, clientY: 30 });
    open();
    const menu = screen.getByRole('menu', { name: 'terminal' });
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(['Copy', 'Paste', 'Select all', 'Clear']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    expect(clipboard.writeText).toHaveBeenCalledWith('picked');
    expect(screen.queryByRole('menu', { name: 'terminal' })).toBeNull();
    open();
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' })));
    expect(registry.renderer.paste).toHaveBeenCalledWith('from the clipboard');
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select all' }));
    expect(registry.renderer.selectAll).toHaveBeenCalled();
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear' }));
    expect(registry.renderer.clear).toHaveBeenCalled();
  });
});
