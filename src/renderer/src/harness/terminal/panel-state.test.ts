// The `#panel` harness's stand-in host against a mocked registry: unregistering a tool closes its tabs through the
// tool's own close path, so a Terminal tab's shell is killed (and a tab whose close fails stays, to be retried).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostState } from '@shared/ipc/schema';
import type { TerminalInfo } from '../../terminal/registry';

const registry = vi.hoisted(() => {
  let infos: TerminalInfo[] = [];
  let next = 0;
  return {
    reset() {
      infos = [];
      next = 0;
    },
    terminals: {
      list: () => infos,
      host: (): HostState | null => ({ state: 'ready', pid: 1, restarts: 0, revision: 1 }),
      subscribe: () => () => {},
      open: vi.fn((init: { appSessionId: string; label: string; cwd: string }) => {
        const id = `t${++next}`;
        infos = [...infos, { id, appSessionId: init.appSessionId, label: init.label, cwd: init.cwd, status: 'running' } as unknown as TerminalInfo];
        return id;
      }),
      get: (id: string) => {
        const info = infos.find((i) => i.id === id);
        return info ? { info, renderer: null, container: document.createElement('div') } : undefined;
      },
      foreground: vi.fn(async () => ({ process: 'zsh', busy: false })),
      close: vi.fn(async () => {}),
    },
  };
});
vi.mock('../../terminal/registry', () => ({ terminals: registry.terminals }));

const { mountPanelHost, registerPanelTool } = await import('../../panel/host');
const { terminalTool } = await import('../../tools/terminal');
const { addTool, closeTab, panelHostImplementation, usePanel } = await import('./panel-state');
const { SESSION_A } = await import('./fakeSessions');

const initial = usePanel.getState();
const cleanups: (() => void)[] = [];

beforeEach(() => {
  registry.reset();
  vi.clearAllMocks();
  registry.terminals.foreground.mockImplementation(async () => ({ process: 'zsh', busy: false }));
  registry.terminals.close.mockImplementation(async () => {});
  usePanel.setState(initial, true);
  cleanups.push(mountPanelHost(panelHostImplementation));
});
afterEach(() => cleanups.splice(0).reverse().forEach((cleanup) => cleanup()));

const terminalTabs = () => Object.values(usePanel.getState().tabs).filter((tab) => tab.toolId === 'terminal');

describe('panel harness host', () => {
  it('kills a terminal’s shell through the tool’s close path when the Terminal tool is unregistered', async () => {
    const unregister = registerPanelTool(terminalTool);
    addTool('terminal', { appSessionId: SESSION_A });
    const [tab] = terminalTabs();
    unregister();
    await vi.waitFor(() => expect(terminalTabs()).toEqual([]));
    expect(registry.terminals.foreground).toHaveBeenCalledWith('t1');
    expect(registry.terminals.close).toHaveBeenCalledWith('t1');
    expect(tab).toBeDefined();
  });

  it('keeps a tab whose close failed when its tool is unregistered, and closes it on a retry', async () => {
    const unregister = registerPanelTool(terminalTool);
    addTool('terminal', { appSessionId: SESSION_A });
    const [tab] = terminalTabs();
    registry.terminals.close.mockRejectedValueOnce(new Error('pty.kill failed: EPERM'));
    unregister();
    await vi.waitFor(() => expect(registry.terminals.close).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(terminalTabs().map((t) => t.id)).toEqual([tab!.id]);
    expect((tab!.state as { ui: { getState(): { closeError: string | null } } }).ui.getState().closeError).toBe('pty.kill failed: EPERM');
    await expect(closeTab(tab!.id)).resolves.toBe(true);
    expect(terminalTabs()).toEqual([]);
    expect(registry.terminals.close).toHaveBeenCalledTimes(2);
  });
});
