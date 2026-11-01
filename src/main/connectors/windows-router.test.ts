// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, acceptance 4, Interfaces §F, D8, D24): the window
// report through main's router on both shapes. Embedded, the connectors are composed on main's router (their handlers
// the embedded machine binding's) and a page's lease is visible once its window was reported, hidden before; on the
// daemon shape, the report is forwarded to the machine host under the page's own client before its first lease command.
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import type { ServicesBus } from '@shared/spine/bus';
import { composeConnectors } from '../../services/connectors';
import { project, record } from '../../../test/support/builders';
import { CONNECTOR_ART as ART, FakeConnectorHost } from '../../../test/support/fake-connector-host';
import { fakeSpineView } from '../../../test/support/fake-spine-view';
import type { HostDispatch } from '../ipc/router';
import type { WindowReporter } from './windows';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const DEV_URL = 'http://localhost:5173/';
const ROWS = { server: 'fixture', tool: 'rows' };

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown, machine?: unknown) => Promise<unknown>>(),
  windows: new Map<object, { webContents: { mainFrame: object } }>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown, machine?: unknown) => Promise<unknown>) => void electron.handlers.set(channel, handler),
  },
  BrowserWindow: { fromWebContents: (webContents: object) => electron.windows.get(webContents) ?? null },
}));

// The native window that shows a page, as electronWindowShown reads it
class FakeWindow extends EventEmitter {
  visible = true;
  isVisible = () => this.visible;
  isMinimized = () => false;
  isDestroyed = () => false;
  hide(): void {
    this.visible = false;
    this.emit('hide');
  }
}

let pageIds = 0;
function page() {
  const mainFrame = { url: DEV_URL, parent: null };
  const sender = Object.assign(new EventEmitter(), { id: ++pageIds, mainFrame, isDestroyed: () => false });
  electron.windows.set(sender, { webContents: sender });
  return { event: { sender, senderFrame: mainFrame }, window: new FakeWindow() };
}

type Router = typeof import('../ipc/router');
let router: Router;
let reporter: WindowReporter | null;
let shownBy: Map<object, FakeWindow>; // a page's webContents → the window that shows it
const invoke = async (event: unknown, name: string, input?: unknown) => {
  const answer = (await electron.handlers.get(`maws:cmd:${name}`)!(event, input)) as { ok: boolean; value?: unknown; error?: unknown };
  if (!answer.ok) throw new Error(`${name}: ${JSON.stringify(answer.error)}`);
  return answer.value;
};
const settle = async () => {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
};

async function install(options: { dispatchToHost?: HostDispatch; machine?: { kind: 'embedded' } | { kind: 'host' } } = {}) {
  vi.resetModules();
  electron.handlers.clear();
  electron.windows.clear();
  router = await import('../ipc/router');
  router.installRouter({ appUrl: DEV_URL, local: LOCAL, ...options });
}
// The reporter as main's root composes it: the production window resolver over the page, the report over main's own route
async function startReporter() {
  const { startWindowReporter } = await import('./windows');
  const { pageOf } = await import('../ipc/clients');
  const { electronWindowShown } = await import('../client/window-shown');
  reporter = startWindowReporter({
    windowShown: (client) => {
      const contents = pageOf(client);
      const win = contents && shownBy.get(contents);
      return win ? electronWindowShown(win as never) : null;
    },
    report: async (client, shown) => (await router.invokeOwn('connectors.windowShown', { shown }, { client, target: LOCAL })).ok,
    before: router.beforeCommand,
    log: () => {},
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  reporter = null;
  shownBy = new Map();
});
afterEach(() => {
  reporter?.stop();
  vi.useRealTimers();
});

describe('the window report on the embedded root', () => {
  let fake: FakeConnectorHost;
  let service: { stop(): void };

  beforeEach(async () => {
    await install({ machine: { kind: 'embedded' } });
    fake = new FakeConnectorHost();
    fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
    const bus = { register: router.registerMachineHandler, emit: () => true } as unknown as Pick<ServicesBus, 'register' | 'emit'>;
    service = composeConnectors({
      hosts: { dispatch: fake.dispatch as never, onEvent: fake.onEvent as never, onState: fake.onState as never, onStreaming: fake.onStreaming as never, streaming: fake.streaming as never },
      bus,
      view: fakeSpineView({ records: [record('app-own', { projectId: 'proj' as never, directory: '/repo' })], projects: [project('proj', 0, { directory: '/repo' })] }),
      realpath: (path) => path,
      port: { openExternal: vi.fn() },
      log: () => {},
    });
  });
  afterEach(() => service.stop());

  async function visibleLease(event: unknown): Promise<string> {
    const { leaseId } = (await invoke(event, 'connectors.open', { artifactId: ART })) as { leaseId: string };
    await invoke(event, 'connectors.declare', { leaseId, tools: [ROWS] });
    await invoke(event, 'connectors.visibility', { leaseId, visible: true });
    return leaseId;
  }

  it('reads a page hidden before any report, and visible once the reporter reported its window', async () => {
    fake.endAtStart = true;
    const { event, window } = page();
    shownBy.set(event.sender, window);
    const unreported = await visibleLease(event);
    expect(await invoke(event, 'connectors.call', { leaseId: unreported, request: ROWS })).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(fake.names()).not.toContain('connectors.resolve');
    await startReporter();
    const leaseId = await visibleLease(event); // the page's next lease command reports its window first
    expect(await invoke(event, 'connectors.call', { leaseId, request: ROWS })).toMatchObject({ ok: true, result: { content: 'rows 107' } });
  });

  it('a hide reported while a call runs withdraws it before its outcome is published', async () => {
    await startReporter();
    const { event, window } = page();
    shownBy.set(event.sender, window);
    const leaseId = await visibleLease(event);
    const answering = invoke(event, 'connectors.call', { leaseId, request: ROWS });
    await settle();
    const [operationId] = fake.started();
    window.hide();
    await settle();
    fake.emit('connectors.operation', { operationId }); // its outcome, there to take
    expect(await answering).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(fake.dispatched.filter((entry) => entry.name === 'connectors.cancel').map((entry) => entry.input)).toEqual([{ operationId }]);
  });

  it('when the page ends, its leases close and its window is let go', async () => {
    fake.endAtStart = true;
    await startReporter();
    const { event, window } = page();
    shownBy.set(event.sender, window);
    const leaseId = await visibleLease(event);
    await invoke(event, 'connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } });
    await settle();
    const starts = fake.started().length;
    event.sender.emit('destroyed');
    expect(window.listenerCount('hide')).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fake.started()).toHaveLength(starts);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the window report on the daemon shape', () => {
  it('is forwarded to the machine host under the page’s own client before the page’s first lease command', async () => {
    const forwarded: [string, unknown, string | undefined][] = [];
    const dispatchToHost = vi.fn<HostDispatch>(async (_owner, name, input, client) => {
      forwarded.push([name, input, client?.id]);
      return { ok: true, value: name === 'connectors.windowShown' ? { ok: true } : { leaseId: '66666666-6666-4666-8666-666666666666' } };
    });
    await install({ dispatchToHost, machine: { kind: 'host' } });
    await startReporter();
    const { event, window } = page();
    shownBy.set(event.sender, window);
    await invoke(event, 'connectors.open', { artifactId: ART });
    await invoke(event, 'connectors.close', { leaseId: '66666666-6666-4666-8666-666666666666' });
    const id = `page:${event.sender.id}.1`;
    expect(forwarded).toEqual([
      ['connectors.windowShown', { shown: true }, id],
      ['connectors.open', { artifactId: ART }, id],
      ['connectors.close', { leaseId: '66666666-6666-4666-8666-666666666666' }, id],
    ]);
    expect(dispatchToHost.mock.calls.every(([owner]) => owner === 'machine')).toBe(true);
  });
});
