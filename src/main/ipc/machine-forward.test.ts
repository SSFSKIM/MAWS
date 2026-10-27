// P5 O1 M5, acceptance 4: one fixture `machine` namespace, `probe`, invoked through the router twice: bound embedded (its
// handlers run in main) and bound to a host (the same handlers run in a host runtime behind a real Unix socket, reached
// by main's real host supervisor over the detached transport). Both bindings answer alike, and the remote handler sees
// the invoking page's ClientRef, prefixed by its connection, ending when the page does or when the link closes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { fakeProfile, FakeProcesses, FakeSupervisor, type FakeProfile } from '../../../test/support/fake-supervisor';
import { fakePage, type FakePage } from '../../../test/support/fake-page';
import { createHostRuntime, HostCommandError, type HostOn } from '@shared/host/runtime';
import type { WireRegistry } from '@shared/ipc/registry';

// Electron is faked: `ipcMain.handle` records one handler per channel; each fake page is its own window's webContents.
// The supervisor imports electron for its utility transport, which these tests never use.
const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  windows: new Map<object, { webContents: { mainFrame: object } }>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
      if (electron.handlers.has(channel)) throw new Error(`second handler for ${channel}`);
      electron.handlers.set(channel, handler);
    },
  },
  BrowserWindow: { fromWebContents: (webContents: object) => electron.windows.get(webContents) ?? null },
  app: { isPackaged: false, getPath: () => '/nonexistent' },
  utilityProcess: {},
  MessageChannelMain: class {},
}));

import { createRouter, type MachineBinding } from './router';
import { createHostSupervisor, type HostSupervisor } from '../hosts/supervisor';

const APP_URL = 'http://localhost:5173/';
const TIMING = { connectTimeoutMs: 200, helloTimeoutMs: 150, startTimeoutMs: 1_200, pidPollMs: 20, waitRetryMs: 80, killGraceMs: 60 };

const PROBE = {
  commands: {
    'probe.echo': { owner: 'machine', input: z.strictObject({ text: z.string() }), output: z.strictObject({ text: z.string(), client: z.string() }) },
    'probe.hold': { owner: 'machine', input: z.strictObject({ key: z.string() }), output: z.strictObject({ holds: z.number().int() }) },
    'probe.fail': { owner: 'machine', input: z.strictObject({ how: z.enum(['typed', 'thrown']) }), output: z.null() },
  },
  events: {},
  hostEvents: [],
  mainOnly: new Set<string>(),
} as const satisfies WireRegistry;

// The `probe` service, written once and registered in either root: `registerMachine` in main's, `runtime.on` in a host's.
// Holds are counted per client and dropped when the client ends.
function registerProbe(on: HostOn<typeof PROBE>, holds: Map<string, Set<string>>): void {
  on('probe.echo', async ({ text }, { client }) => ({ text, client: client.id }));
  on('probe.hold', async ({ key }, { client }) => {
    let keys = holds.get(client.id);
    if (!keys) {
      const created = (keys = new Set());
      holds.set(client.id, created);
      client.onGone(() => {
        if (holds.get(client.id) === created) holds.delete(client.id);
      });
    }
    keys.add(key);
    return { holds: keys.size };
  });
  on('probe.fail', async ({ how }) => {
    if (how === 'typed') throw new HostCommandError({ code: 'timeout', message: 'the probe gave up after 8 s' });
    throw new Error('the probe broke');
  });
}

interface AppPage {
  page: FakePage;
  event: { sender: FakePage; senderFrame: object };
}

function appPage(): AppPage {
  const page = fakePage();
  const mainFrame = { url: APP_URL, parent: null };
  electron.windows.set(page, { webContents: { mainFrame } });
  return { page, event: { sender: page, senderFrame: mainFrame } };
}

const invoke = (from: AppPage, name: string, input?: unknown) => {
  const handler = electron.handlers.get(`maws:cmd:${name}`);
  if (!handler) throw new Error(`no ipcMain handler for ${name}`);
  return handler(from.event, input) as Promise<{ ok: boolean; value?: unknown; error?: unknown }>;
};

const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true), { timeout: 3_000, interval: 5 });

// One binding of the probe namespace, its router installed: `holds` is the handlers' own state, wherever they run.
interface Bound {
  holds: Map<string, Set<string>>;
  fake: FakeSupervisor | null; // the host binding's remote end
  close(): Promise<void>;
}

let profile: FakeProfile;
let processes: FakeProcesses;

beforeEach(() => {
  electron.handlers.clear();
  electron.windows.clear();
  profile = fakeProfile('maws-mf-');
  processes = new FakeProcesses();
});

afterEach(() => profile.dispose());

async function bind(kind: MachineBinding['kind']): Promise<Bound> {
  electron.handlers.clear();
  const holds = new Map<string, Set<string>>();
  if (kind === 'embedded') {
    const router = createRouter({ appUrl: APP_URL, registry: PROBE, machine: { kind } });
    registerProbe(router.registerMachine, holds);
    router.install();
    return { holds, fake: null, close: async () => {} };
  }
  const runtime = createHostRuntime<typeof PROBE>((on) => registerProbe(on, holds), { registry: PROBE });
  const fake = await new FakeSupervisor(profile, processes, { pid: processes.newPid(), runtime }).start();
  const supervisor: HostSupervisor = createHostSupervisor({
    hosts: { machine: { modulePath: profile.modulePath, serviceName: 'maws-machine', transport: 'detached' } },
    registry: PROBE,
    emit: () => true,
    restartBackoffMs: [30, 60, 90],
    detached: {
      userData: () => profile.userData,
      packaged: () => false,
      env: () => ({ HOME: '/home/owner', MAWS_HOST_MODE: 'detached' }),
      spawn: () => {
        throw new Error('the test runs its own supervisor; nothing is spawned');
      },
      ...processes.deps,
      timing: TIMING,
      log: () => {},
    },
  });
  await supervisor.start();
  expect(supervisor.snapshot('machine').state).toBe('ready');
  const router = createRouter({ appUrl: APP_URL, registry: PROBE, dispatchToHost: supervisor.dispatch, machine: { kind } });
  router.install();
  return {
    holds,
    fake,
    close: async () => {
      supervisor.stop();
      await fake.die();
    },
  };
}

// Every outcome but the client id, which differs by design.
async function answersOf(from: AppPage) {
  return {
    typed: await invoke(from, 'probe.fail', { how: 'typed' }),
    thrown: await invoke(from, 'probe.fail', { how: 'thrown' }),
    invalid: await invoke(from, 'probe.echo', { text: 5 }),
    echo: await invoke(from, 'probe.echo', { text: 'hello' }),
  };
}

describe('a machine namespace, embedded and over a host link (P5 O1 M5)', () => {
  it('answers alike in both bindings, with the remote client id the page’s own, prefixed by its connection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // the embedded router logs the thrown failure
    const from = appPage();
    const embedded = await bind('embedded');
    const local = await answersOf(from);
    await embedded.close();
    const host = await bind('host');
    const remote = await answersOf(from);
    await host.close();

    expect(local.typed).toEqual({ ok: false, error: { code: 'timeout', message: 'the probe gave up after 8 s' } });
    expect(remote.typed).toEqual(local.typed);
    expect(local.thrown).toEqual({ ok: false, error: { code: 'internal', message: 'the probe broke' } });
    expect(remote.thrown).toEqual(local.thrown);
    expect(local.invalid).toMatchObject({ ok: false, error: { code: 'invalid_input', issues: [{ path: ['text'] }] } });
    expect(remote.invalid).toEqual(local.invalid); // answered by the router before either binding

    const pageClient = `page:${from.page.id}.1`;
    expect(local.echo).toEqual({ ok: true, value: { text: 'hello', client: pageClient } });
    expect(remote.echo).toEqual({ ok: true, value: { text: 'hello', client: expect.stringMatching(/^\d+\//) } });
    const remoteClient = (remote.echo.value as { client: string }).client;
    expect(remoteClient.slice(remoteClient.indexOf('/') + 1)).toBe(pageClient);
  });

  it.each(['embedded', 'host'] as const)('drops a page’s holds when the page goes, and only that page’s (%s)', async (kind) => {
    const bound = await bind(kind);
    const [a, b] = [appPage(), appPage()];
    await expect(invoke(a, 'probe.hold', { key: 'x' })).resolves.toEqual({ ok: true, value: { holds: 1 } });
    await expect(invoke(a, 'probe.hold', { key: 'y' })).resolves.toEqual({ ok: true, value: { holds: 2 } });
    await expect(invoke(b, 'probe.hold', { key: 'x' })).resolves.toEqual({ ok: true, value: { holds: 1 } });
    expect(bound.holds.size).toBe(2);
    a.page.destroy();
    await until(() => bound.holds.size === 1);
    expect([...bound.holds.keys()][0]).toMatch(new RegExp(`page:${b.page.id}\\.1$`));
    // a reloaded page is a new client: its holds start afresh, and its previous instance's are gone
    await invoke(b, 'probe.hold', { key: 'y' });
    b.page.reload();
    await until(() => bound.holds.size === 0);
    await expect(invoke(b, 'probe.hold', { key: 'x' })).resolves.toEqual({ ok: true, value: { holds: 1 } });
    await bound.close();
  });

  it('ends every remote client of a link when the link closes, and a client asking again is held on the next link', async () => {
    const bound = await bind('host');
    const [a, b] = [appPage(), appPage()];
    await invoke(a, 'probe.hold', { key: 'x' });
    await invoke(b, 'probe.hold', { key: 'x' });
    const before = [...bound.holds.keys()];
    expect(before).toHaveLength(2);
    bound.fake!.dropClient(); // the supervisor lives on; main reconnects
    await until(() => bound.holds.size === 0);
    await expect(invoke(a, 'probe.hold', { key: 'x' })).resolves.toEqual({ ok: true, value: { holds: 1 } });
    const [after] = [...bound.holds.keys()];
    expect(after).not.toBe(before[0]); // a fresh connection prefix, the same page part
    expect(after!.slice(after!.indexOf('/'))).toBe(before[0]!.slice(before[0]!.indexOf('/')));
    await bound.close();
  });
});

// The client rides on a `machine` request only: a pre-O1 supervisor reads the engine host's envelope strictly, so an
// engine-host request never carries it, even when a caller passes one.
describe('the engine host’s envelope (P5 O1 M5)', () => {
  const ENGINE_PROBE = {
    commands: { 'probe.who': { owner: 'engine-host', input: z.undefined(), output: z.string() } },
    events: {},
    hostEvents: [],
    mainOnly: new Set<string>(),
  } as const satisfies WireRegistry;

  it('sends no client to the engine host', async () => {
    const runtime = createHostRuntime<typeof ENGINE_PROBE>((on) => on('probe.who', async (_input, { client }) => client.id), { registry: ENGINE_PROBE });
    const fake = await new FakeSupervisor(profile, processes, { pid: processes.newPid(), runtime }).start();
    const supervisor = createHostSupervisor({
      hosts: { 'engine-host': { modulePath: profile.modulePath, serviceName: 'maws-engine-host', transport: 'detached' } },
      registry: ENGINE_PROBE,
      emit: () => true,
      detached: { userData: () => profile.userData, packaged: () => false, env: () => ({ HOME: '/home/owner' }), ...processes.deps, timing: TIMING, log: () => {} },
    });
    await supervisor.start();
    const asker = { id: 'page:1.1', onGone: () => () => {} } as never;
    await expect(supervisor.dispatch('engine-host', 'probe.who', undefined, asker)).resolves.toEqual({ ok: true, value: expect.stringMatching(/^\d+$/) }); // the connection's own
    supervisor.stop();
    await fake.die();
  });

  it('answers host_unavailable for an owner with no host', async () => {
    const supervisor = createHostSupervisor({ hosts: {}, emit: () => true });
    await expect(supervisor.dispatch('machine', 'probe.echo', { text: 'x' })).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
  });
});
