// The shells no session owns keep spawning (P5 O6 M2, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "Ids
// the renderer mints"): Settings › Engine's update terminal, the Drive setup terminal and the diagnostics strip's echo
// test each file their shell under an owner the page mints. The page's client lowers every id it sends and refuses a
// bare one, so each owner is followed from where it is made to the `pty.spawn` main receives: the real producer, the
// real Terminal tool and page registry where the owner goes through them, and the page's client over a fake main that
// speaks bare ids. Only the emulator is a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { GWS_INSTALL } from '../delivery/copy';
import { openGwsTerminal } from '../delivery/SendToSheet';
import { createClient } from '../ipc/client';
import { panelHost } from '../panel/host';
import type { PanelToolInit } from '../panel/tool';
import { openEngineUpdate } from '../settings-tab/engine-update';
import { createEchoStore, ECHO_MARKER } from '../stores/echo';
import { terminalTool, type TerminalParams } from '../tools/terminal';
import { terminals } from './registry';
import { FakeRenderer } from './renderer.fake';
import { TERMINAL_TOKEN_NAMES } from './theme';

vi.mock('./renderer', async (actual) => ({ ...(await actual<typeof import('./renderer')>()), createRenderer: async (_kind: string, opts: never) => new FakeRenderer(opts) }));

// Main's side of the preload bridge: bare ids in and out, and the machine each invoke was addressed to. Its PTY host
// answers a spawn, and a write with the echo test's marker line.
function fakeMain() {
  const listeners = new Map<string, Set<(payload: unknown, machine?: MachineRef) => void>>();
  const send = (name: string, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload, TEST_MACHINE));
  const invoke = vi.fn<(name: string, input: unknown, machine?: MachineRef) => Promise<unknown>>(async (name) => {
    switch (name) {
      case 'pty.spawn':
        return { ok: true, value: { ptyId: 'pty-1', pid: 4242 } };
      case 'pty.write':
        setTimeout(() => send('pty.data', { ptyId: 'pty-1', offset: 0, data: new TextEncoder().encode(`${ECHO_MARKER}\r\n`) }));
        return { ok: true, value: undefined };
      case 'pty.hostState':
        return { ok: true, value: { state: 'ready', pid: 42, restarts: 0, revision: 1 } };
      default:
        return { ok: true, value: undefined };
    }
  });
  const on = vi.fn((name: string, listener: (payload: unknown, machine?: MachineRef) => void) => {
    const set = listeners.get(name) ?? new Set();
    set.add(listener);
    listeners.set(name, set);
    return () => set.delete(listener);
  });
  const bridge = { localMachine: TEST_MACHINE, invoke, on } as unknown as PreloadBridge;
  return { bridge, spawns: () => invoke.mock.calls.filter(([name]) => name === 'pty.spawn').map(([, input, machine]) => ({ input, machine })) };
}

let main: ReturnType<typeof fakeMain>;

beforeEach(() => {
  for (const name of TERMINAL_TOKEN_NAMES) document.documentElement.style.setProperty(name, 'fixture'); // the tokens the emulator's theme reads (any value)
  main = fakeMain();
  window.maws = main.bridge;
});

afterEach(() => {
  vi.restoreAllMocks();
  window.maws = { localMachine: TEST_MACHINE } as unknown as PreloadBridge;
});

// Opens what `open` asks the panel host for as the page would (the Terminal tool's state, then its view's mount) and
// answers the `pty.spawn` main received.
// The page's registry outlives a test, so each tab has a label of its own.
async function spawnThroughTerminalTab(instanceId: string, open: () => string) {
  const addTool = vi.spyOn(panelHost, 'addTool').mockReturnValue(instanceId);
  open();
  const [, init] = addTool.mock.calls[0]!;
  const state = terminalTool.createState({ ...init, session: null, instanceId } as PanelToolInit<TerminalParams>);
  terminals.mount(state.terminalId!, document.body.appendChild(document.createElement('div')));
  await vi.waitFor(() => expect(main.spawns()).toHaveLength(1));
  return main.spawns()[0]!;
}

describe('a synthetic pty owner reaches main as a bare id on the local machine', () => {
  it("Settings › Engine's update terminal", async () => {
    const spawn = await spawnThroughTerminalTab('terminal:1', openEngineUpdate);
    expect(spawn).toEqual({ input: expect.objectContaining({ appSessionId: 'maws-engine-update', label: 'terminal:1', cwd: '/' }), machine: TEST_MACHINE });
  });

  it('the Drive setup terminal', async () => {
    const spawn = await spawnThroughTerminalTab('terminal:2', () => openGwsTerminal(GWS_INSTALL));
    expect(spawn).toEqual({ input: expect.objectContaining({ appSessionId: 'maws-gws-setup', label: 'terminal:2', cwd: '/' }), machine: TEST_MACHINE });
  });

  it("the diagnostics strip's echo test", async () => {
    const echo = createEchoStore(createClient(() => window.maws));
    await echo.getState().run();
    expect(echo.getState().echo).toMatchObject({ status: 'ok', pid: 4242 });
    expect(main.spawns()).toEqual([{ input: expect.objectContaining({ appSessionId: 'diagnostics', shell: '/bin/sh' }), machine: TEST_MACHINE }]);
  });
});
