// The Terminal tool against a mocked registry (C9 M4 unit pins): the state factory, the close veto, the attach entry
// point, and the view's mount, worktree warning, title suffix, lifecycle bars and context menu.
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { HostState, PtyInfo } from '@shared/ipc/schema';
import { instanceOf, panelHost, registerPanelTool } from '../../panel/host';
import type { PanelToolContext } from '../../panel/tool';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { resetPanelStores } from '../../test-support/panel';
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
    remove(id: string) {
      infos = infos.filter((info) => info.id !== id);
      publish();
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
      close: vi.fn(async (id: string): Promise<void> => void id),
      respawn: vi.fn(async () => {}),
      adopt: vi.fn(async (accept?: (info: PtyInfo) => boolean, onListed?: (adopting: { label: string; id: string; attached: Promise<string | null> }[]) => void): Promise<string[]> => {
        void accept;
        onListed?.([]);
        return [];
      }),
    },
  };
});

vi.mock('../../terminal/registry', () => ({ terminals: registry.terminals }));

const { ADOPTION_TIMEOUT_MS, adoptTerminals, openTerminal, resetTerminalAdoption, terminalTool, TERMINAL_TOOL_ID } = await import('./index');

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
  // a close that works disposes the handle, as the registry's does
  registry.terminals.close.mockImplementation(async (id: string) => registry.remove(id));
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

  it('ends a still-running terminal on dispose (a host removing a session’s tabs asks nobody), once', () => {
    const state = newState();
    terminalTool.dispose(state);
    terminalTool.dispose(state);
    expect(registry.terminals.close.mock.calls).toEqual([[state.terminalId]]);
  });

  it('kills nothing on dispose after a completed beforeClose, and logs a dispose kill that fails', async () => {
    const closed = newState();
    await expect(terminalTool.beforeClose(closed)).resolves.toBe(true);
    terminalTool.dispose(closed);
    expect(registry.terminals.close).toHaveBeenCalledTimes(1);

    const failing = newState({ instanceId: 'terminal:2' });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    registry.terminals.close.mockRejectedValueOnce(new Error('pty.kill failed: EPERM'));
    terminalTool.dispose(failing);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledOnce());
    logged.mockRestore();
  });
});

// C8a's ruling (2026-09-29): a restored tab waits for the page's re-adoption, so it reattaches to its running pty; the
// wait is per tab (only a label the host listed waits for its attach) and bounded by ADOPTION_TIMEOUT_MS.
describe('re-adoption before a tab opens a shell', () => {
  beforeEach(() => resetTerminalAdoption());
  afterEach(() => {
    resetTerminalAdoption();
    vi.useRealTimers();
  });

  // What the registry's adopt does: once `list` answers, an entry under each accepted pty's label whose attach is under
  // way; `attach(label)` answers that attach (a pty whose attach failed answers with no terminal).
  function hostAdoption() {
    const attaches = new Map<string, (ok: boolean) => void>();
    let list!: (labels: string[]) => void;
    registry.terminals.adopt.mockImplementationOnce(
      (accept = () => true, onListed) =>
        new Promise<string[]>((resolveAll) => {
          list = (labels) => {
            const adopting = labels
              .filter((label) => accept({ label, appSessionId: A } as PtyInfo))
              .map((label) => {
                const id = registry.terminals.open({ appSessionId: A, label, cwd: '/tmp/maws-harness/a' });
                const attached = new Promise<string | null>((resolve) => attaches.set(label, (ok) => resolve(ok ? id : null)));
                return { label, id, attached };
              });
            registry.terminals.open.mockClear();
            onListed?.(adopting);
            void Promise.all(adopting.map(({ attached }) => attached)).then((ids) => resolveAll(ids.filter((id): id is string => id !== null)));
          };
        }),
    );
    return { list: (labels: string[]) => list(labels), attach:(label: string, ok = true) => attaches.get(label)!(ok) };
  }

  it('opens nothing while the adoption is in flight, then takes the pty re-adopted under the tab’s label', async () => {
    const host = hostAdoption();
    const adoption = adoptTerminals();
    const state = newState({ instanceId: 'terminal:restored' });
    expect(state.terminalId).toBeNull();
    host.list(['terminal:restored']);
    await Promise.resolve();
    expect(state.terminalId).toBeNull(); // listed: it waits for the attach
    host.attach('terminal:restored');
    await expect(adoption).resolves.toEqual(['t1']);
    await vi.waitFor(() => expect(state.terminalId).toBe('t1'));
    expect(registry.terminals.open).not.toHaveBeenCalled();
  });

  it('a tab disposed while the adoption is in flight opens nothing and releases the shell re-adopted under its label', async () => {
    const host = hostAdoption();
    const adoption = adoptTerminals();
    const state = newState({ instanceId: 'terminal:gone' });
    terminalTool.dispose(state); // closed (beforeClose saw no terminal), reconciled or unregistered before adoption answered
    host.list(['terminal:gone']);
    host.attach('terminal:gone');
    await adoption;
    await vi.waitFor(() => expect(registry.terminals.close).toHaveBeenCalledWith('t1'));
    expect(registry.terminals.open).not.toHaveBeenCalled();
    expect(state.terminalId).toBeNull();
  });

  it('opens its own shell once the adoption answers without a pty for it, and after a failed adoption', async () => {
    const host = hostAdoption();
    const adoption = adoptTerminals();
    const state = newState({ instanceId: 'terminal:new' });
    host.list([]);
    await adoption;
    await vi.waitFor(() => expect(state.terminalId).toBe('t1'));
    expect(registry.terminals.open).toHaveBeenCalledOnce();

    resetTerminalAdoption();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    registry.terminals.adopt.mockRejectedValueOnce(new Error('pty host gone'));
    await adoptTerminals();
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
    expect(newState({ instanceId: 'terminal:after' }).terminalId).toBe('t2');
  });

  it('holds only the tab whose label the host listed: a tab with another label opens its shell once the list answers', async () => {
    const host = hostAdoption();
    void adoptTerminals();
    const restored = newState({ instanceId: 'terminal:restored' });
    const fresh = newState({ instanceId: 'terminal:fresh' }); // a tab opened from "+" while the adoption runs
    expect(fresh.terminalId).toBeNull(); // before the list answers, any label may be the host's
    host.list(['terminal:restored']);
    await vi.waitFor(() => expect(fresh.terminalId).toBe('t2'));
    expect(registry.terminals.open).toHaveBeenCalledWith({ appSessionId: A, label: 'terminal:fresh', cwd: '/tmp/maws-harness/a' });
    expect(restored.terminalId).toBeNull(); // its attach is still under way
    host.attach('terminal:restored');
    await vi.waitFor(() => expect(restored.terminalId).toBe('t1'));
  });

  it('bounds an attach that never answers: the stale handle is closed and never taken, and its tab opens a new shell', async () => {
    expect(ADOPTION_TIMEOUT_MS).toBe(10_000);
    vi.useFakeTimers();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = hostAdoption();
    const adoption = adoptTerminals();
    const state = newState({ instanceId: 'terminal:stuck' });
    registry.terminals.close.mockImplementationOnce(() => new Promise(() => {})); // even its kill hangs
    host.list(['terminal:stuck']);
    await vi.advanceTimersByTimeAsync(ADOPTION_TIMEOUT_MS - 1);
    expect(state.terminalId).toBeNull();
    expect(registry.terminals.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(registry.terminals.close).toHaveBeenCalledWith('t1');
    await expect(adoption).resolves.toEqual([]);
    expect(state.terminalId).toBe('t2'); // a new shell, not the handle still listed under its label
    expect(registry.terminals.open).toHaveBeenCalledWith({ appSessionId: A, label: 'terminal:stuck', cwd: '/tmp/maws-harness/a' });
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it('bounds a list that never answers: every tab opens a new shell, and a list answering after adopts nothing', async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = hostAdoption();
    const adoption = adoptTerminals();
    const state = newState({ instanceId: 'terminal:restored' });
    await vi.advanceTimersByTimeAsync(ADOPTION_TIMEOUT_MS);
    await expect(adoption).resolves.toEqual([]);
    expect(state.terminalId).toBe('t1');
    host.list(['terminal:restored']);
    expect(registry.terminals.list()).toHaveLength(1); // nothing re-created under the label its new shell took
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});

describe('openTerminal', () => {
  it('asks the panel host for a Terminal tab with the cwd and command as params', () => {
    // C8a's host replaced C9's stand-in seam (the stand-in fold, ruling O2): the call is observed on `panelHost` itself.
    const addTool = vi.spyOn(panelHost, 'addTool').mockReturnValue('terminal:7');
    try {
      expect(openTerminal({ appSessionId: A, cwd: '/tmp/maws-harness/a', command: 'printf MAWS_ATTACH_OK\\n' })).toBe('terminal:7');
      expect(addTool).toHaveBeenCalledWith('terminal', { appSessionId: A, params: { cwd: '/tmp/maws-harness/a', command: 'printf MAWS_ATTACH_OK\\n' } });
    } finally {
      addTool.mockRestore();
    }
  });
});

// Ported from C9's stand-in host test (harness/terminal/panel-state.test.ts) onto C8a's host by the stand-in fold:
// unregistering the Terminal tool closes its tabs through the tool's own close path.
describe('the panel host unregistering the Terminal tool', () => {
  beforeEach(() => {
    resetPanelStores();
    useSessions.setState({ records: new Map([[A, SESSION_A]]) }); // the tab's session, whose directory its shell starts in
  });
  const terminalRefs = () => useLayout.getState().panelTabsOf(A).filter((ref) => ref.toolId === TERMINAL_TOOL_ID);

  it('kills a terminal’s shell through the tool’s close path', async () => {
    const unregister = registerPanelTool(terminalTool);
    panelHost.addTool('terminal', { appSessionId: A, activate: false });
    expect(terminalRefs()).toHaveLength(1);
    unregister();
    await vi.waitFor(() => expect(terminalRefs()).toEqual([]));
    expect(registry.terminals.foreground).toHaveBeenCalledWith('t1');
    expect(registry.terminals.close).toHaveBeenCalledWith('t1');
  });

  it('keeps a tab whose close failed, and closes it on a retry', async () => {
    const unregister = registerPanelTool(terminalTool);
    const tabId = panelHost.addTool('terminal', { appSessionId: A, activate: false });
    registry.terminals.close.mockRejectedValueOnce(new Error('pty.kill failed: EPERM'));
    unregister();
    await vi.waitFor(() => expect(registry.terminals.close).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(terminalRefs().map((ref) => ref.id)).toEqual([tabId]);
    expect((instanceOf(tabId)!.state as { ui: { getState(): { closeError: string | null } } }).ui.getState().closeError).toBe('pty.kill failed: EPERM');
    await expect(panelHost.closeTab(tabId)).resolves.toBe(true);
    expect(terminalRefs()).toEqual([]);
    expect(registry.terminals.close).toHaveBeenCalledTimes(2);
  });
});

describe('terminal view', () => {
  it('mounts the terminal’s container while visible without taking focus, focuses on request, and detaches on unmount', () => {
    const state = newState();
    const { rerender, unmount } = render(<View state={state} ctx={context()} />);
    expect(registry.terminals.mount).toHaveBeenCalledWith(state.terminalId, expect.any(HTMLElement), { focus: false });
    expect(registry.terminals.focus).not.toHaveBeenCalled();
    rerender(<View state={state} ctx={context({ focusRequest: 1 })} />);
    expect(registry.terminals.focus).toHaveBeenCalledWith(state.terminalId);
    unmount();
    expect(registry.terminals.unmount).toHaveBeenCalledWith(state.terminalId);
  });

  it('keeps a selected tab’s focus through StrictMode’s simulated remount', () => {
    const state = newState();
    render(
      <StrictMode>
        <View state={state} ctx={context({ focusRequest: 1 })} />
      </StrictMode>,
    );
    // the first pass focuses and uses the request up; the remount that follows unmounts the container and mounts it
    // again with the focus carried over, which the registry restores once the container is back in place
    expect(registry.terminals.focus).toHaveBeenCalledOnce();
    expect(registry.terminals.unmount).toHaveBeenCalledOnce();
    expect(registry.terminals.mount).toHaveBeenLastCalledWith(state.terminalId, expect.any(HTMLElement), { focus: true });
  });

  it('does not replay a focus request made before the terminal started, nor one a remount carries over', () => {
    const state = terminalTool.createState({ appSessionId: null, session: null, instanceId: 'terminal:8', params: {} });
    const { rerender, unmount } = render(<View state={state} ctx={context({ appSessionId: null, session: null, focusRequest: 1 })} />);
    rerender(<View state={state} ctx={context({ appSessionId: B, session: SESSION_B, focusRequest: 1 })} />);
    expect(state.terminalId).toBe('t1');
    expect(registry.terminals.focus).not.toHaveBeenCalled();
    rerender(<View state={state} ctx={context({ appSessionId: B, session: SESSION_B, focusRequest: 2 })} />);
    expect(registry.terminals.focus).toHaveBeenCalledOnce();
    unmount();
    render(<View state={state} ctx={context({ appSessionId: B, session: SESSION_B, focusRequest: 2 })} />);
    expect(registry.terminals.focus).toHaveBeenCalledOnce();
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
    expect(registry.terminals.mount).toHaveBeenCalledWith('t1', expect.any(HTMLElement), { focus: false });
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

  it('says the shell is starting over the surface until the terminal runs, without a bar that would resize it', () => {
    const state = newState();
    render(<View state={state} ctx={context()} />);
    act(() => registry.patch(state.terminalId!, { status: 'starting' }));
    // a live region whose visible text is all there is to it: no label that differs from what is shown
    const starting = screen.getByText('Starting shell…');
    expect(starting.getAttribute('role')).toBe('status');
    expect(starting.hasAttribute('aria-label')).toBe(false);
    expect(starting.parentElement).toBe(screen.getByTestId('terminal-surface').parentElement);
    act(() => registry.patch(state.terminalId!, { status: 'running' }));
    expect(screen.queryByText('Starting shell…')).toBeNull();
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
